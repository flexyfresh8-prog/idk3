// idk3 — interactive subwoofer simulator (entry point)
// Loads the supplied GLB, verifies the component mapping, and drives the
// whole audio-reactive simulation loop.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import './style.css';

import { DEFAULT_PARAMS, type SimParams } from './core/types';
import { auditModel, type AuditResult, type AuditedPart } from './core/gltfAudit';
import { SurroundDeformer } from './core/surroundDeform';
import { ConeAssembly } from './core/assembly';
import { ExcursionPhysics, calibratedVoltageGain } from './core/physics';
import { AudioEngine } from './audio/audioEngine';
import { Stage } from './scene/stage';
import { MaterialLibrary, FINISHES } from './scene/materials';
import { ParamsPanel } from './ui/paramsPanel';
import { Inspector } from './ui/inspector';
import { PlayerUI } from './ui/playerUI';

const MODEL_URL = `${import.meta.env.BASE_URL}models/tripo_model_1793179198729.glb`;
const MM = 0.001; // glTF units are meters
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const params: SimParams = { ...DEFAULT_PARAMS };
const engine = new AudioEngine();
const physics = new ExcursionPhysics();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const loadingEl = $('loading');
const loadingText = $('loading-text');
const viewport = $('viewport');

function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  window.setTimeout(() => el.remove(), 5200);
}

// ------------------------------------------------------------------ boot
async function boot(): Promise<void> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder as any);

  const gltf = await new Promise<any>((resolve, reject) => {
    loader.load(
      MODEL_URL,
      (g) => resolve(g),
      (ev) => {
        if (ev.total > 0) loadingText.textContent = `Loading subwoofer model… ${(ev.loaded / ev.total * 100).toFixed(0)}%`;
        else loadingText.textContent = `Loading subwoofer model… ${(ev.loaded / 1048576).toFixed(1)} MB`;
      },
      (err) => reject(new Error(`Model failed to load: ${err}`))
    );
  });

  const root: THREE.Object3D = gltf.scene;
  const audit: AuditResult = auditModel(root);

  // ---------------- scene
  const stage = new Stage(viewport, audit.modelCenter, audit.modelRadius);
  stage.scene.add(root);

  const mats = new MaterialLibrary();
  const kindList: { mesh: THREE.Mesh; kind: any }[] = [];
  for (const p of audit.parts) {
    mats.applyTo(p.mesh, p.spec.material);
    kindList.push({ mesh: p.mesh, kind: p.spec.material });
  }

  // ---------------- mechanics
  const deformer = new SurroundDeformer(
    audit.surroundParts, audit.axis, audit.axisPoint, audit.rInGlobal, audit.rOutGlobal
  );
  // +1/-1: converts "positive = outward excursion" into motion along the
  // model axis (this model fires toward −Z, so outwardSign = −1).
  const outwardSign = audit.outward.dot(audit.axis) >= 0 ? 1 : -1;
  const assembly = new ConeAssembly(audit.axis, outwardSign);
  assembly.attach(audit.movingParts);
  stage.scene.add(assembly.group);

  // ---------------- UI: verification notes
  const verifyList = $('verify-list');
  for (const n of audit.notes) {
    const li = document.createElement('li');
    li.textContent = n;
    verifyList.appendChild(li);
  }

  // ---------------- visibility system
  const perPartVisible = new Map<number, boolean>();
  const groupChecks = {
    enclosure: $('vis-enclosure') as HTMLInputElement,
    frame: $('vis-frame') as HTMLInputElement,
    motor: $('vis-internals') as HTMLInputElement
  };

  function applyVisibility(): void {
    const solo = inspector.soloPart;
    for (const p of audit.parts) {
      let vis: boolean;
      if (solo) vis = solo === p;
      else if (perPartVisible.has(p.index)) vis = perPartVisible.get(p.index)!;
      else {
        switch (p.spec.group) {
          case 'enclosure': vis = groupChecks.enclosure.checked; break;
          case 'frame': vis = groupChecks.frame.checked; break;
          case 'motor': vis = groupChecks.motor.checked; break;
          default: vis = true;
        }
      }
      p.mesh.visible = vis;
    }
    assembly.group.visible = audit.movingParts.some((p) => p.mesh.visible);
  }

  function setMode(next: 'full' | 'driver'): void {
    $('mode-full').classList.toggle('active', next === 'full');
    $('mode-driver').classList.toggle('active', next === 'driver');
    ($('mode-full') as HTMLButtonElement).setAttribute('aria-selected', String(next === 'full'));
    ($('mode-driver') as HTMLButtonElement).setAttribute('aria-selected', String(next === 'driver'));
    if (next === 'driver') groupChecks.enclosure.checked = false; // driver-only preset
    applyVisibility();
    toast(next === 'driver' ? 'Driver-only view — enclosure drum hidden.' : 'Complete subwoofer view.', 'info');
  }

  // ---------------- UI: inspector
  const inspector = new Inspector($('component-list'), audit.parts, {
    onSelect: () => { /* highlight handled in loop */ },
    onVisibility: (part, visible) => { perPartVisible.set(part.index, visible); applyVisibility(); },
    onSolo: () => applyVisibility(),
    onResetTransform: (part: AuditedPart) => {
      if (assembly.memberParts.includes(part)) {
        assembly.detachPart(part);
        toast(`${part.spec.label} detached from the moving assembly and reset.`);
      } else {
        part.mesh.position.copy(part.restPosition);
        part.mesh.quaternion.copy(part.restQuaternion);
        part.mesh.scale.copy(part.restScale);
        toast(`${part.spec.label} transform reset.`);
      }
    }
  });

  // ---------------- UI: params
  const paramsPanel = new ParamsPanel($('params'), params);
  paramsPanel.onChange = (key, value) => {
    if (key === 'audioGain') engine.setGain(value);
    if (key === 'lfCutoffHz') engine.setLfCutoff(value);
    if (key === 'surroundFlexibility') deformer.rebuildWeights(value);
  };
  paramsPanel.onReset = () => {
    resetSim();
    toast('Simulation reset to defaults.');
  };

  // ---------------- UI: player
  const player = new PlayerUI(engine, {
    fileChip: $('file-chip'),
    playBtn: $('play-btn') as HTMLButtonElement,
    restartBtn: $('restart-btn') as HTMLButtonElement,
    seek: $('seek') as HTMLInputElement,
    time: $('time'),
    volume: $('volume') as HTMLInputElement,
    muteBtn: $('mute-btn') as HTMLButtonElement,
    importBtn: $('import-btn') as HTMLButtonElement,
    testBtn: $('test-btn') as HTMLButtonElement,
    spectrum: $('spectrum') as HTMLCanvasElement,
    bassBar: $('bar-bass'), midBar: $('bar-mid'), highBar: $('bar-high'),
    excursionOut: $('excursion-out'),
    dropOverlay: $('drop-overlay'),
    toast
  });

  // ---------------- header + mobile buttons
  $('reset-cam').addEventListener('click', () => stage.resetCamera());
  $('top-reset-sim').addEventListener('click', () => { resetSim(); toast('Simulation reset to defaults.'); });
  for (const [btn, panel] of [['toggle-left', 'left-panel'], ['toggle-right', 'right-panel']] as const) {
    $(btn).addEventListener('click', () => {
      const el = $(panel);
      const open = el.classList.toggle('open');
      ($(btn) as HTMLButtonElement).setAttribute('aria-expanded', String(open));
    });
  }

  groupChecks.enclosure.addEventListener('change', applyVisibility);
  groupChecks.frame.addEventListener('change', applyVisibility);
  groupChecks.motor.addEventListener('change', applyVisibility);
  $('vis-fiber').addEventListener('change', (e) => mats.setFiberDetail((e.target as HTMLInputElement).checked));

  // ---------------- Finish studio: swap the whole PBR pack live
  const finishList = $('finish-list');
  for (const f of FINISHES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'finish-swatch' + (f.id === mats.finishId ? ' active' : '');
    btn.dataset.finish = f.id;
    btn.title = f.desc;
    btn.setAttribute('aria-label', `Finish: ${f.label}`);
    const chip = document.createElement('span');
    chip.className = 'finish-chip';
    chip.style.background = `linear-gradient(135deg, ${f.chip[0]} 0%, ${f.chip[0]} 46%, ${f.chip[1]} 54%, ${f.chip[1]} 100%)`;
    const txt = document.createElement('span');
    txt.className = 'finish-label';
    txt.textContent = f.label;
    btn.appendChild(chip);
    btn.appendChild(txt);
    btn.addEventListener('click', () => {
      mats.setFinish(f.id, kindList);
      finishList.querySelectorAll('.finish-swatch').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.finish === f.id));
      toast(`Finish: ${f.label}.`, 'info');
    });
    finishList.appendChild(btn);
  }

  function resetSim(): void {
    paramsPanel.resetToDefaults();
    physics.reset();
    deformer.reset();
    assembly.reset();
    engine.setGain(params.audioGain);
    engine.setLfCutoff(params.lfCutoffHz);
  }

  // ------------------------------------------------------------------ loop
  // stillMode (?still=1): render on demand only — used by automated tests and
  // very weak devices; a manual single-frame render hook is exposed below.
  const stillMode = new URLSearchParams(location.search).get('still') === '1';
  let last = performance.now();
  let uiAccum = 0;
  let debugD: number | null = null; // test hook: forced static excursion (world units)
  const lastFrame = { drive: 0, bass: 0, mid: 0, high: 0, playing: false, rms: 0, peak: 0 };

  function loopBody(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const frame = engine.frame(dt, params.hfCutoffHz);

    // TRUE dot-to-dot physics: the cone is a fully coupled electro-mechanical
    // system (voltage → coil current → Lorentz force → motion, with back-EMF,
    // Le(x) inductance droop, nonlinear Bl(x), Duffing spring + box air load)
    // driven by the actual bass waveform samples, integrated with RK4 one
    // step per audio sample. Voltage is calibrated so a full-scale
    // (AGC-normalized) note at resonance produces ≈ maxExcursion of travel.
    const maxUnits = params.maxExcursionMM * MM;
    const vGain = calibratedVoltageGain(maxUnits, params.resonanceHz)
      * params.bassSensitivity * params.animationIntensity;
    const d = debugD !== null ? debugD : physics.stepAudio(frame.driveSamples, frame.driveSampleRate, dt, {
      voltageGain: vGain,
      zeta: 0.30 + 0.55 * clamp01(params.smoothing),
      maxUnits,
      resonanceHz: params.resonanceHz,
      boxLoad: params.boxLoad,
      coneMass: params.coneMass
    });

    // Both the moving assembly and the surround field use the same signed
    // outward displacement, so the cone rim and the surround inner edge stay
    // perfectly in register (no gap / no shear). The deformer works directly
    // in model-axis units, hence the outwardSign conversion.
    assembly.setDisplacement(d, params.coilFollow);
    deformer.apply(d * outwardSign, params.surroundStrength);
    inspector.updateHighlight(dt);

    lastFrame.drive = frame.drive;
    lastFrame.bass = frame.bass;
    lastFrame.mid = frame.mid;
    lastFrame.high = frame.high;
    lastFrame.rms = frame.rms;
    lastFrame.peak = frame.peak;
    lastFrame.playing = frame.playing || engine.testToneActive;

    uiAccum += dt;
    if (uiAccum > 1 / 30) {
      uiAccum = 0;
      player.frame();
      player.setLevels(frame.bass, frame.mid, frame.high, assembly.currentD);
      player.drawSpectrum(lastFrame.playing ? frame.spectrum : null, engine.sampleRate);
    }

    if (!stillMode) stage.tick(dt);
  }
  function loop(now: number): void {
    requestAnimationFrame(loop);
    loopBody(now);
  }
  if (!stillMode) requestAnimationFrame(loop);
  else {
    last = performance.now();
    loopBody(performance.now());
    stage.tick(1 / 60);
    (window as any).__simRenderOnce = () => { loopBody(performance.now()); stage.tick(1 / 60); };
  }

  // ------------------------------------------------------------------ test hook (used by automated browser tests)
  (window as any).__sim = {
    version: '3.0.0',
    mapping: () => audit.parts.map((p) => ({
      index: p.index, name: p.nodeName, label: p.spec.label, role: p.spec.role,
      group: p.spec.group, verts: p.verts, tris: p.tris,
      rIn: +p.rIn.toFixed(4), rOut: +p.rOut.toFixed(4), visible: p.mesh.visible
    })),
    surround: () => ({ rIn: audit.rInGlobal, rOut: audit.rOutGlobal, coneRim: audit.coneRimRadius, parts: audit.surroundParts.map((p) => p.index) }),
    axis: () => ({ axis: audit.axis.toArray(), outward: audit.outward.toArray() }),
    params,
    displacementMM: () => assembly.currentD,
    frame: () => ({ ...lastFrame }),
    engine,
    startTestTone: () => engine.startTestTone(),
    stopTestTone: () => engine.stopTestTone(),
    setMode,
    applyVisibility,
    loadFile: (f: File) => player.loadFile(f),
    resetSim,
    forceDisplacement: (mm: number) => { debugD = mm * MM; return debugD; },
    clearForcedDisplacement: () => { debugD = null; },
    isForced: () => debugD !== null,
    stageLite: () => stage.lite,
    /** Numerical acceptance probe: world Z of the moving parts + local axial
     *  extent of the three deformed surround meshes (rest z span ≈ fixed). */
    probe: () => {
      const out: Record<string, number> = {};
      const wp = new THREE.Vector3();
      const cone = audit.byIndex.get(21), cap = audit.byIndex.get(6), coil = audit.byIndex.get(1);
      cone?.mesh.getWorldPosition(wp); out.coneZ = +wp.z.toFixed(5);
      cap?.mesh.getWorldPosition(wp); out.capZ = +wp.z.toFixed(5);
      coil?.mesh.getWorldPosition(wp); out.coilZ = +wp.z.toFixed(5);
      for (const idx of [19, 15, 4]) {
        const m = audit.byIndex.get(idx)?.mesh;
        if (!m) continue;
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox!;
        out[`sur${idx}MinZ`] = +bb.min.z.toFixed(5);
        out[`sur${idx}MaxZ`] = +bb.max.z.toFixed(5);
      }
      out.currentDmm = +assembly.currentD.toFixed(3);
      return out;
    },
    /** Surround normal-orientation diagnostic: how outward-facing are the
     *  current vertex normals of each surround mesh? A healthy half-roll has
     *  outwardDot clearly positive; ~0 means half the faces are flipped
     *  (inconsistent winding — e.g. after an unguarded computeVertexNormals).
     *  flippedAtRest: fraction of vertices whose current normal opposes the
     *  AUTHORED GLB normal (captured before the first deformer pass). */
    surroundNormals: () => {
      const out: Record<string, unknown> = {};
      const v = new THREE.Vector3(), n = new THREE.Vector3(), rad = new THREE.Vector3();
      for (const idx of [19, 15, 4]) {
        const p = audit.byIndex.get(idx);
        if (!p) continue;
        const geo = p.mesh.geometry;
        const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
        const nAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
        if (!nAttr) { out[`m${idx}`] = { hasNormals: false, verts: posAttr.count }; continue; }
        const authored = (geo.userData as { authoredNormals?: Float32Array }).authoredNormals;
        p.mesh.updateWorldMatrix(true, false);
        let outwardSum = 0, flipVsAuthored = 0, sampled = 0;
        const step = Math.max(1, Math.floor(posAttr.count / 500));
        for (let i = 0; i < posAttr.count; i += step) {
          v.fromBufferAttribute(posAttr, i).applyMatrix4(p.mesh.matrixWorld);
          n.fromBufferAttribute(nAttr, i).transformDirection(p.mesh.matrixWorld);
          rad.copy(v).sub(audit.axisPoint);
          rad.addScaledVector(audit.axis, -rad.dot(audit.axis)).normalize();
          outwardSum += n.dot(rad);
          if (authored) {
            const a = new THREE.Vector3(authored[i * 3], authored[i * 3 + 1], authored[i * 3 + 2]).normalize();
            if (a.dot(n) < 0) flipVsAuthored++;
          }
          sampled++;
        }
        out[`m${idx}`] = {
          hasNormals: true, verts: posAttr.count, sampled,
          outwardDot: +(outwardSum / sampled).toFixed(3),
          hasAuthored: !!authored,
          flippedFrac: authored ? +(flipVsAuthored / sampled).toFixed(3) : null,
          // raw-data sanity: how many sampled normals are non-zero vectors?
          nonZero: (() => {
            let k = 0;
            for (let i = 0; i < posAttr.count; i += step) {
              if (nAttr.getX(i) !== 0 || nAttr.getY(i) !== 0 || nAttr.getZ(i) !== 0) k++;
            }
            return k;
          })(),
          normalVersion: nAttr.version
        };
      }
      return out;
    },
    stats: () => ({ parts: audit.parts.length, verts: audit.parts.reduce((s, p) => s + p.verts, 0), tris: audit.parts.reduce((s, p) => s + p.tris, 0) }),
    /** Direct mesh access for diagnostics / browser-side verification. */
    mesh: (index: number) => audit.byIndex.get(index)?.mesh ?? null
  };

  loadingEl.classList.remove('show');
  toast(`Model loaded — ${audit.parts.length} parts identified. Import an MP3 or start the bass test tone.`, 'info');
}

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = err.message || 'Failed to load the model.';
  loadingEl.querySelector('.loader-ring')?.remove();
  toast(err.message || 'Failed to load.', 'error');
});

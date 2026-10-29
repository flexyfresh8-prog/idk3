// idk3 v4 — interactive subwoofer dyno lab with MULTI-DRIVER hot-swap.
// Loads the selected driver's GLB, verifies the component mapping, and drives
// the whole audio-reactive simulation loop. The 10-inch reference sub and the
// 2-inch mini sub (drivers.ts) share one physics/audio/UI pipeline; switching
// swaps the model live — audio keeps playing, the camera flies to the new
// framing, and simulation parameters adopt the driver's profile.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import './style.css';

import { DEFAULT_PARAMS, PARAM_META, type SimParams, type ParamMeta } from './core/types';
import { auditModel, type AuditResult } from './core/gltfAudit';
import { SurroundDeformer } from './core/surroundDeform';
import { ConeAssembly } from './core/assembly';
import { generateCylindricalUVs } from './core/uv';
import { DRIVERS, driverById, type DriverProfile } from './core/drivers';
import { ExcursionPhysics, calibratedVoltageGain, REALISTIC_ZETA } from './core/physics';
import { AudioEngine } from './audio/audioEngine';
import { Stage } from './scene/stage';
import { MaterialLibrary, FINISHES } from './scene/materials';
import { ParamsPanel } from './ui/paramsPanel';
import { Inspector } from './ui/inspector';
import { PlayerUI } from './ui/playerUI';

const MM = 0.001; // glTF units are meters

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

// ------------------------------------------------------------------ glb io
const glbCache = new Map<string, ArrayBuffer>();

async function loadGlbBuffer(url: string): Promise<ArrayBuffer> {
  const hit = glbCache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed (${res.status}) for ${url}`);
  const buf = await res.arrayBuffer();
  glbCache.set(url, buf);
  return buf;
}

function parseGlb(buffer: ArrayBuffer): Promise<any> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder as any);
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', (g) => resolve(g), (err) => reject(new Error(`Model failed to parse: ${err}`)));
  });
}

// ------------------------------------------------------------------ boot
async function boot(): Promise<void> {
  // holder object: TS closure-narrowing turns `let x: T | null = null` reads
  // after closure-assignments into `never` — properties are immune
  const ctx3d: { stage: Stage | null; mats: MaterialLibrary | null } = { stage: null, mats: null };
  let current: {
    profile: DriverProfile;
    root: THREE.Object3D;
    audit: AuditResult;
    deformer: SurroundDeformer;
    assembly: ConeAssembly;
    outwardSign: number;
    scale: number;
    kindList: { mesh: THREE.Mesh; kind: any }[];
  } | null = null;
  let inspector: Inspector | null = null;
  let paramsPanel: ParamsPanel | null = null;
  let switching = false;
  let debugD: number | null = null; // test hook: forced static excursion (world units)

  const perPartVisible = new Map<number, boolean>();
  const groupChecks = {
    enclosure: $('vis-enclosure') as HTMLInputElement,
    frame: $('vis-frame') as HTMLInputElement,
    motor: $('vis-internals') as HTMLInputElement
  };

  /** Per-driver slider metadata: base PARAM_META overridden by the profile. */
  function metaFor(profile: DriverProfile): ParamMeta[] {
    return PARAM_META.map((m) => ({ ...m, ...(profile.ranges[m.key] ?? {}) }));
  }

  function applyVisibility(): void {
    if (!current || !inspector) return;
    const solo = inspector.soloPart;
    for (const p of current.audit.parts) {
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
    current.assembly.group.visible = current.audit.movingParts.some((p) => p.mesh.visible);
  }

  function setMode(next: 'full' | 'driver'): void {
    $('mode-full').classList.toggle('active', next === 'full');
    $('mode-driver').classList.toggle('active', next === 'driver');
    ($('mode-full') as HTMLButtonElement).setAttribute('aria-selected', String(next === 'full'));
    ($('mode-driver') as HTMLButtonElement).setAttribute('aria-selected', String(next === 'driver'));
    if (next === 'driver') groupChecks.enclosure.checked = false; // driver-only preset
    applyVisibility();
    toast(next === 'driver' ? 'Driver-only view — enclosure hidden.' : 'Complete subwoofer view.', 'info');
  }

  // ---------------------------------------------------------------- mount
  async function mountDriver(profile: DriverProfile, opts: { first?: boolean } = {}): Promise<void> {
    if (switching || (current && current.profile.id === profile.id)) return;
    switching = true;
    if (!opts.first) {
      setDriverButtons(current?.profile.id ?? '', true);
      loadingText.textContent = `Mounting ${profile.fullName}…`;
      loadingEl.classList.add('show');
    }
    try {
      const buffer = await loadGlbBuffer(`${import.meta.env.BASE_URL}${profile.modelFile}`);
      const gltf = await parseGlb(buffer);
      const root: THREE.Object3D = gltf.scene;

      // pass 1 audit: measures the authored geometry (needed to solve the
      // uniform scale for 'driver-inches' profiles — never hardcode scale)
      root.updateMatrixWorld(true);
      let audit = auditModel(root, profile);
      let scale = 1;
      if (profile.scaleMode.kind === 'driver-inches') {
        scale = (profile.scaleMode.inches * 0.0254) / (2 * audit.rOutGlobal);
        root.scale.setScalar(scale);
        root.updateMatrixWorld(true);
        audit = auditModel(root, profile); // pass 2: re-measure at final scale
      }

      // procedural UVs: both GLBs ship without TEXCOORD (gltfpack strips
      // them) — cylindrical projection around the driver axis unlocks the
      // whole procedural PBR library (weave, brushed metal, carpet)
      generateCylindricalUVs(root, audit.axis, audit.axisPoint);

      // dispose the previous driver AFTER the new one is parsed (swap, not gap)
      if (current && ctx3d.stage) {
        ctx3d.stage.scene.remove(current.root);
        ctx3d.stage.scene.remove(current.assembly.group);
        for (const p of current.audit.parts) p.mesh.geometry.dispose();
        current = null;
        inspector = null;
      }

      if (!ctx3d.stage) ctx3d.stage = new Stage(viewport, audit.modelCenter, audit.modelRadius);
      else ctx3d.stage.reframe(audit.modelCenter, audit.modelRadius);
      ctx3d.stage.scene.add(root);

      if (!ctx3d.mats) ctx3d.mats = new MaterialLibrary();
      const kindList: { mesh: THREE.Mesh; kind: any }[] = [];
      for (const p of audit.parts) {
        ctx3d.mats.applyTo(p.mesh, p.spec.material);
        kindList.push({ mesh: p.mesh, kind: p.spec.material });
      }
      // Shadow casters: enclosure + moving assembly only (motor internals are
      // sealed inside; the surround is coplanar with the frame). Halves the
      // shadow pass with no visible difference on the ground.
      for (const p of audit.parts) {
        const g = p.spec.group;
        p.mesh.castShadow = g === 'enclosure' || g === 'moving';
      }

      const deformer = new SurroundDeformer(
        audit.surroundParts, audit.axis, audit.axisPoint, audit.rInGlobal, audit.rOutGlobal,
        1 / scale // uniforms are LOCAL units; excursion arrives in world units
      );
      deformer.refreshMaterials();
      // +1/-1: converts "positive = outward excursion" into motion along the
      // model axis (10-inch fires toward −Z, the mini toward +Z).
      const outwardSign = audit.outward.dot(audit.axis) >= 0 ? 1 : -1;
      const assembly = new ConeAssembly(audit.axis, outwardSign);
      assembly.attach(audit.movingParts);
      ctx3d.stage.scene.add(assembly.group);

      current = { profile, root, audit, deformer, assembly, outwardSign, scale, kindList };

      // ---------------- UI: verification notes
      const verifyList = $('verify-list');
      verifyList.innerHTML = '';
      for (const n of audit.notes) {
        const li = document.createElement('li');
        li.textContent = n;
        verifyList.appendChild(li);
      }

      // ---------------- UI: driver info chip
      const driverInches = (2 * audit.rOutGlobal) / 0.0254;
      const info = $('driver-info');
      info.innerHTML = '';
      const nameEl = document.createElement('div');
      nameEl.className = 'driver-name';
      nameEl.textContent = `${profile.fullName} · ${audit.parts.length} parts`;
      const tagEl = document.createElement('div');
      tagEl.className = 'driver-tag';
      tagEl.textContent = `${profile.tagline} · measured driver ≈ ${driverInches.toFixed(2)}″`;
      info.appendChild(nameEl);
      info.appendChild(tagEl);

      // ---------------- UI: inspector (rebuilt per driver)
      inspector = new Inspector($('component-list'), audit.parts, {
        onSelect: () => { /* highlight handled in loop */ },
        onVisibility: (part, visible) => { perPartVisible.set(part.index, visible); applyVisibility(); },
        onSolo: () => applyVisibility(),
        onMaterialClone: (part, clone) => {
          // Highlight clones lose onBeforeCompile — re-inject the deform shader
          if (part.spec.group === 'surround') deformer.patchMaterial(clone);
        },
        onResetTransform: (part) => {
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

      // ---------------- params: adopt the driver profile
      Object.assign(params, DEFAULT_PARAMS, profile.defaults);
      const meta = metaFor(profile);
      for (const m of meta) params[m.key] = Math.min(m.max, Math.max(m.min, params[m.key]));
      // The deformer constructor builds weights with the GENERIC default
      // flexibility (0.6); re-derive them from the driver profile so a hot-
      // swapped driver's roll character applies without touching the slider.
      deformer.rebuildWeights(params.surroundFlexibility);
      if (!paramsPanel) {
        paramsPanel = new ParamsPanel($('params'), params, meta, profile.defaults);
        paramsPanel.onChange = (key, value) => {
          if (key === 'audioGain') engine.setGain(value);
          if (key === 'lfCutoffHz') engine.setLfCutoff(value);
          if (key === 'surroundFlexibility') deformer.rebuildWeights(value);
        };
        paramsPanel.onReset = () => {
          resetSim();
          toast('Simulation reset to defaults.');
        };
      } else {
        paramsPanel.rebuild(meta, profile.defaults);
      }
      paramsPanel.syncAll();
      physics.reset();
      engine.setGain(params.audioGain);
      engine.setLfCutoff(params.lfCutoffHz);

      // ---------------- visibility state resets for the new driver
      perPartVisible.clear();
      debugD = null; // a forced displacement from the other driver is meaningless here
      if (!opts.first) {
        groupChecks.enclosure.checked = true;
        groupChecks.frame.checked = true;
        groupChecks.motor.checked = true;
      }
      applyVisibility();

      // ---------------- URL + buttons + toast
      const u = new URL(location.href);
      if (profile.id === 'fullsize') u.searchParams.delete('driver');
      else u.searchParams.set('driver', profile.id);
      history.replaceState(null, '', u);
      setDriverButtons(profile.id, false);

      if (!opts.first) {
        loadingEl.classList.remove('show');
        toast(`${profile.fullName} mounted — ${audit.parts.length} parts, driver ≈ ${driverInches.toFixed(2)}″${scale !== 1 ? ` (model scaled ×${scale.toFixed(3)})` : ''}.`, 'info');
      }
    } catch (err: any) {
      // keep the previous driver alive on failure
      loadingEl.classList.remove('show');
      toast(err?.message || `Failed to mount ${profile.fullName}.`, 'error');
      setDriverButtons(current?.profile.id ?? 'fullsize', false);
    } finally {
      switching = false;
    }
  }

  function setDriverButtons(activeId: string, busy: boolean): void {
    for (const d of DRIVERS) {
      const btn = $(`driver-${d.id}`) as HTMLButtonElement | null;
      if (!btn) continue;
      btn.classList.toggle('active', d.id === activeId);
      btn.setAttribute('aria-selected', String(d.id === activeId));
      btn.disabled = busy;
    }
  }

  // ---------------- UI: params defaults (initial mount created the panel)
  function resetSim(): void {
    paramsPanel?.resetToDefaults();
    physics.reset();
    current?.deformer.reset();
    current?.assembly.reset();
    engine.setGain(params.audioGain);
    engine.setLfCutoff(params.lfCutoffHz);
  }

  // ---------------- mount the driver requested in the URL (default 10-inch)
  const initialProfile = driverById(new URLSearchParams(location.search).get('driver') ?? 'fullsize');
  await mountDriver(initialProfile, { first: true });

  // ---------------- header + driver switcher
  const switchWrap = $('driver-switch');
  for (const d of DRIVERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `driver-${d.id}`;
    btn.className = 'mode-btn' + (d.id === initialProfile.id ? ' active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(d.id === initialProfile.id));
    btn.title = `Switch to the ${d.fullName}`;
    btn.textContent = d.name;
    btn.addEventListener('click', () => void mountDriver(d));
    switchWrap.appendChild(btn);
  }

  $('reset-cam').addEventListener('click', () => ctx3d.stage?.resetCamera());
  $('top-reset-sim').addEventListener('click', () => { resetSim(); toast('Simulation reset to defaults.'); });
  for (const [btn, panel] of [['toggle-left', 'left-panel'], ['toggle-right', 'right-panel']] as const) {
    $(btn).addEventListener('click', () => {
      const el = $(panel);
      const open = el.classList.toggle('open');
      ($(btn) as HTMLButtonElement).setAttribute('aria-expanded', String(open));
    });
  }

  // ---------------- focus (no-UI) mode
  // Only the 3D viewport stays, with a floating pill holding exactly two
  // controls: import song + play/pause. The REAL #import-btn / #play-btn
  // nodes are moved into the pill, so every listener keeps working with zero
  // duplicated logic. Toggle via the header button, Esc, or ?noui=1.
  const importBtnEl = $('import-btn') as HTMLButtonElement;
  const playBtnEl = $('play-btn') as HTMLButtonElement;
  const restartBtnEl = $('restart-btn') as HTMLButtonElement;
  const seekEl = $('seek') as HTMLInputElement;
  const transportControlsEl = importBtnEl.parentElement!; // .transport-controls
  const nouiSlot = $('noui-slot');

  function applyNoUi(on: boolean, pushUrl = true, announce = true): void {
    const wasOn = document.body.classList.contains('noui');
    if (wasOn === on) return;
    document.body.classList.toggle('noui', on);
    ($('focus-mode') as HTMLButtonElement).setAttribute('aria-pressed', String(on));
    if (on) {
      nouiSlot.append(importBtnEl, playBtnEl);
    } else {
      transportControlsEl.insertBefore(importBtnEl, restartBtnEl);
      transportControlsEl.insertBefore(playBtnEl, seekEl);
    }
    if (pushUrl) {
      const u = new URL(location.href);
      if (on) u.searchParams.set('noui', '1'); else u.searchParams.delete('noui');
      history.replaceState(null, '', u);
    }
    if (announce) {
      toast(on ? 'Focus mode — import & play only. Esc or the corner button exits.'
               : 'Full lab UI restored.', 'info');
    }
  }
  $('focus-mode').addEventListener('click', () => applyNoUi(!document.body.classList.contains('noui')));
  $('noui-exit').addEventListener('click', () => applyNoUi(false));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('noui')) applyNoUi(false);
  });
  if (new URLSearchParams(location.search).has('noui')) {
    applyNoUi(true, /* pushUrl */ false, /* announce */ false);
  }

  groupChecks.enclosure.addEventListener('change', applyVisibility);
  groupChecks.frame.addEventListener('change', applyVisibility);
  groupChecks.motor.addEventListener('change', applyVisibility);
  $('vis-fiber').addEventListener('change', (e) => ctx3d.mats?.setFiberDetail((e.target as HTMLInputElement).checked));

  // ---------------- Finish studio: swap the whole PBR pack live
  const finishList = $('finish-list');
  for (const f of FINISHES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'finish-swatch' + (f.id === (ctx3d.mats?.finishId ?? '') ? ' active' : '');
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
      if (!ctx3d.mats || !current) return;
      ctx3d.mats.setFinish(f.id, current.kindList);
      current.deformer.refreshMaterials(); // new material instances need the deform patch
      finishList.querySelectorAll('.finish-swatch').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.finish === f.id));
      toast(`Finish: ${f.label}.`, 'info');
    });
    finishList.appendChild(btn);
  }

  // ---------------- UI: player
  const player = new PlayerUI(engine, {
    fileChip: $('file-chip'),
    playBtn: playBtnEl,
    restartBtn: restartBtnEl,
    seek: seekEl,
    time: $('time'),
    volume: $('volume') as HTMLInputElement,
    muteBtn: $('mute-btn') as HTMLButtonElement,
    importBtn: importBtnEl,
    testBtn: $('test-btn') as HTMLButtonElement,
    spectrum: $('spectrum') as HTMLCanvasElement,
    bassBar: $('bar-bass'), midBar: $('bar-mid'), highBar: $('bar-high'),
    excursionOut: $('excursion-out'),
    dropOverlay: $('drop-overlay'),
    toast
  });

  // ------------------------------------------------------------------ loop
  // stillMode (?still=1): render on demand only — used by automated tests and
  // very weak devices; a manual single-frame render hook is exposed below.
  const stillMode = new URLSearchParams(location.search).get('still') === '1';
  let last = performance.now();
  let uiAccum = 0;
  const lastFrame = { drive: 0, bass: 0, mid: 0, high: 0, playing: false, rms: 0, peak: 0 };

  function loopBody(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const frame = engine.frame(dt, params.hfCutoffHz);

    // TRUE dot-to-dot physics: the cone is a fully coupled electro-mechanical
    // system driven by the actual bass waveform samples, integrated with RK4
    // one step per audio sample. Voltage is calibrated so a full-scale note at
    // resonance drives the cone to ≈ 1.75 × Xmax for EVERY driver profile.
    const maxUnits = params.maxExcursionMM * MM;
    const vGain = calibratedVoltageGain(maxUnits, params.resonanceHz, params.boxLoad)
      * params.bassSensitivity * params.animationIntensity;
    const d = debugD !== null ? debugD : physics.stepAudio(frame.driveSamples, frame.driveSampleRate, dt, {
      voltageGain: vGain,
      zeta: REALISTIC_ZETA,
      maxUnits,
      resonanceHz: params.resonanceHz,
      boxLoad: params.boxLoad,
      coneMass: params.coneMass
    });

    if (current) {
      // Both the moving assembly and the surround field use the same signed
      // outward displacement, so the cone rim and the surround inner edge stay
      // perfectly in register (no gap / no shear).
      current.assembly.setDisplacement(d, params.coilFollow);
      current.deformer.apply(d * current.outwardSign, params.surroundStrength);
    }
    inspector?.updateHighlight(dt);

    lastFrame.drive = frame.drive;
    lastFrame.bass = frame.bass;
    lastFrame.mid = frame.mid;
    lastFrame.high = frame.high;
    lastFrame.rms = frame.rms;
    lastFrame.peak = frame.peak;
    lastFrame.playing = frame.playing || engine.testToneActive;

    const motionActive = frame.playing || engine.testToneActive
      || Math.abs(physics.velocity) > 1e-4 || debugD !== null
      || (ctx3d.stage?.camAnimActive() ?? false);

    uiAccum += dt;
    if (uiAccum > 1 / 30) {
      uiAccum = 0;
      if (!document.body.classList.contains('noui')) {
        player.frame();
        player.setLevels(frame.bass, frame.mid, frame.high, current ? current.assembly.currentD : 0);
        player.drawSpectrum(lastFrame.playing ? frame.spectrum : null, engine.sampleRate);
      }
    }

    if (!stillMode) ctx3d.stage?.tick(dt, motionActive);
  }
  function loop(now: number): void {
    requestAnimationFrame(loop);
    loopBody(now);
  }
  if (!stillMode) requestAnimationFrame(loop);
  else {
    last = performance.now();
    loopBody(performance.now());
    ctx3d.stage?.tick(1 / 60);
    (window as any).__simRenderOnce = () => { loopBody(performance.now()); ctx3d.stage?.tick(1 / 60); };
  }

  // ------------------------------------------------------------------ test hook (used by automated browser tests)
  (window as any).__sim = {
    version: '4.0.0',
    driver: () => {
      if (!current) return null;
      const { profile, audit, scale } = current;
      return {
        id: profile.id, name: profile.fullName, scale,
        parts: audit.parts.length,
        measuredDriverInches: +((2 * audit.rOutGlobal) / 0.0254).toFixed(3),
        surround: audit.surroundParts.map((p) => p.index),
        moving: audit.movingParts.map((p) => p.index)
      };
    },
    setDriver: (id: string) => void mountDriver(driverById(id)),
    mapping: () => current ? current.audit.parts.map((p) => ({
      index: p.index, name: p.nodeName, label: p.spec.label, role: p.spec.role,
      group: p.spec.group, verts: p.verts, tris: p.tris,
      rIn: +p.rIn.toFixed(4), rOut: +p.rOut.toFixed(4), visible: p.mesh.visible
    })) : [],
    surround: () => current ? {
      rIn: current.audit.rInGlobal, rOut: current.audit.rOutGlobal,
      coneRim: current.audit.coneRimRadius,
      parts: current.audit.surroundParts.map((p) => p.index)
    } : null,
    axis: () => current ? ({ axis: current.audit.axis.toArray(), outward: current.audit.outward.toArray() }) : null,
    params,
    displacementMM: () => current ? current.assembly.currentD : 0,
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
    stageLite: () => ctx3d.stage?.lite ?? false,
    /** Adaptive-performance telemetry (dynamic resolution + idle skipping). */
    perf: () => ctx3d.stage ? ctx3d.stage.perfInfo() : null,
    /** Focus (no-UI) mode controls for tests/automation. */
    setNoUi: (on: boolean) => applyNoUi(on),
    isNoUi: () => document.body.classList.contains('noui'),
    /** Numerical acceptance probe: world Z of the moving parts + deformed
     *  local axial extent of the surround meshes (roles resolved dynamically
     *  per driver profile). */
    probe: () => {
      const out: Record<string, number> = {};
      if (!current) return out;
      const wp = new THREE.Vector3();
      const cone = current.audit.parts.find((p) => p.spec.role === 'cone');
      const cap = current.audit.parts.find((p) => p.spec.role === 'dustCap');
      const coil = current.audit.parts.find((p) => p.spec.role === 'voiceCoil');
      cone?.mesh.getWorldPosition(wp); out.coneZ = +wp.z.toFixed(5);
      cap?.mesh.getWorldPosition(wp); out.capZ = +wp.z.toFixed(5);
      coil?.mesh.getWorldPosition(wp); out.coilZ = +wp.z.toFixed(5);
      const dz = current.deformer.getDeformedBoundsZ();
      for (const sp of current.audit.surroundParts) {
        const b = dz[sp.index];
        if (!b) continue;
        out[`sur${sp.index}MinZ`] = +b.min.toFixed(5);
        out[`sur${sp.index}MaxZ`] = +b.max.toFixed(5);
      }
      out.currentDmm = +current.assembly.currentD.toFixed(3);
      return out;
    },
    /** GPU-deform wiring check (test hook): the shared uniforms the surround
     *  shader reads. uD is in the MODEL'S LOCAL units — divide the world
     *  displacement by __sim.driver().scale to get the expected value. */
    deformState: () => {
      if (!current) return { uD: 0, uBulge: 0 };
      const u = current.deformer.getUniformsForTest();
      return { uD: +u.uD.value.toFixed(6), uBulge: +u.uBulge.value.toFixed(6) };
    },
    surroundNormals: () => {
      const out: Record<string, unknown> = {};
      if (!current) return out;
      const v = new THREE.Vector3(), n = new THREE.Vector3(), rad = new THREE.Vector3();
      for (const sp of current.audit.surroundParts) {
        const p = sp;
        const geo = p.mesh.geometry;
        const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
        const nAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
        if (!nAttr) { out[`m${p.index}`] = { hasNormals: false, verts: posAttr.count }; continue; }
        const authored = (geo.userData as { authoredNormals?: Float32Array }).authoredNormals;
        p.mesh.updateWorldMatrix(true, false);
        let outwardSum = 0, flipVsAuthored = 0, sampled = 0;
        const step = Math.max(1, Math.floor(posAttr.count / 500));
        for (let i = 0; i < posAttr.count; i += step) {
          v.fromBufferAttribute(posAttr, i).applyMatrix4(p.mesh.matrixWorld);
          n.fromBufferAttribute(nAttr, i).transformDirection(p.mesh.matrixWorld);
          rad.copy(v).sub(current.audit.axisPoint);
          rad.addScaledVector(current.audit.axis, -rad.dot(current.audit.axis)).normalize();
          outwardSum += n.dot(rad);
          if (authored) {
            const a = new THREE.Vector3(authored[i * 3], authored[i * 3 + 1], authored[i * 3 + 2]).normalize();
            if (a.dot(n) < 0) flipVsAuthored++;
          }
          sampled++;
        }
        out[`m${p.index}`] = {
          hasNormals: true, verts: posAttr.count, sampled,
          outwardDot: +(outwardSum / sampled).toFixed(3),
          hasAuthored: !!authored,
          flippedFrac: authored ? +(flipVsAuthored / sampled).toFixed(3) : null,
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
    stats: () => current ? ({
      parts: current.audit.parts.length,
      verts: current.audit.parts.reduce((s, p) => s + p.verts, 0),
      tris: current.audit.parts.reduce((s, p) => s + p.tris, 0)
    }) : ({ parts: 0, verts: 0, tris: 0 }),
    /** Direct mesh access for diagnostics / browser-side verification. */
    mesh: (index: number) => current ? (current.audit.byIndex.get(index)?.mesh ?? null) : null,
    /** Stage access for GPU verification diagnostics (renderer/scene/camera). */
    stage: () => ctx3d.stage
  };

  loadingEl.classList.remove('show');
  toast(`Model loaded — ${initialProfile.fullName}. Import an MP3 or start the bass test tone.`, 'info');
}

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = err.message || 'Failed to load the model.';
  loadingEl.querySelector('.loader-ring')?.remove();
  toast(err.message || 'Failed to load.', 'error');
});

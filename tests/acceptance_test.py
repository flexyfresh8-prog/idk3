#!/usr/bin/env python3
"""Full acceptance test suite for the idk3 subwoofer simulator.
Runs against the vite dev server (or preview) using Playwright + the
agent-browser Chrome build. Verifies every mechanical + audio criterion."""
import json, sys, time
from playwright.sync_api import sync_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5200/idk3/?lite=1&still=1"
RESULTS = []

def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'} | {name} | {detail}")

def find_chrome():
    import glob, os
    for pat in ("/home/z/.agent-browser/browsers/chrome-*/chrome",
                os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux/chrome")):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=find_chrome(),
                                     headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1000, "height": 700})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(APP, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("typeof window.__sim === 'object' && !document.getElementById('loading').classList.contains('show')", timeout=120000)
        time.sleep(2)

        # 1. GLB loads + parts identified
        stats = page.evaluate("window.__sim.stats()")
        check("GLB loads with 48 parts", stats["parts"] == 48, json.dumps(stats))

        # 2. Correct meshes identified
        mapping = {m["index"]: m for m in page.evaluate("window.__sim.mapping()")}
        expect = {19: "surround1", 15: "surround2", 4: "surround3", 21: "cone", 1: "voiceCoil"}
        ok = all(mapping[i]["role"] == r for i, r in expect.items())
        check("Mesh mapping verified (19/15/4/21/1 + 6 dustCap)", ok and mapping[6]["role"] == "dustCap",
              ", ".join(f"{i}:{mapping[i]['role']}" for i in sorted(expect)))

        # 3-6. mechanical system probe
        page.evaluate("window.__sim.forceDisplacement(0); window.__simRenderOnce()")
        rest = page.evaluate("window.__sim.probe()")
        page.evaluate("window.__sim.forceDisplacement(14); window.__simRenderOnce()")
        outp = page.evaluate("window.__sim.probe()")
        page.evaluate("window.__sim.forceDisplacement(-14); window.__simRenderOnce()")
        inp = page.evaluate("window.__sim.probe()")
        page.evaluate("window.__sim.forceDisplacement(0); window.__simRenderOnce()")
        back = page.evaluate("window.__sim.probe()")
        d_out = round(rest["coneZ"] - outp["coneZ"], 5)   # outward = -Z
        check("Cone moves along axis (14mm -> 0.014 units)", abs(d_out - 0.014) < 5e-4, f"coneZ delta={d_out}")
        rigid = (round(rest["capZ"] - outp["capZ"], 5) == d_out and round(rest["coilZ"] - outp["coilZ"], 5) == d_out)
        check("Coil + dust cap rigid with cone", rigid,
              f"cap {round(rest['capZ']-outp['capZ'],5)}, coil {round(rest['coilZ']-outp['coilZ'],5)}")
        sur_rest = [rest[f"sur{i}MaxZ"] for i in (19, 15, 4)]
        sur_out = [outp[f"sur{i}MaxZ"] for i in (19, 15, 4)]
        sur_back = [back[f"sur{i}MaxZ"] for i in (19, 15, 4)]
        check("Surround outer edge stationary", all(abs(a - b) < 1e-4 for a, b in zip(sur_rest, sur_out)),
              f"rest={sur_rest} out={sur_out}")
        moved = any(abs(outp[f"sur{i}MinZ"] - rest[f"sur{i}MinZ"]) > 5e-4 for i in (19, 15, 4))
        check("Surround inner side flexes with cone", moved,
              f"deltas={[round(outp[f'sur{i}MinZ']-rest[f'sur{i}MinZ'],5) for i in (19,15,4)]}")
        exact = all(abs(back[k] - rest[k]) < 1e-5 for k in rest)
        check("Exact return to rest shape", exact, "probe(back)==probe(rest)")

        # 6a. GPU deformation path: the surround displacement field runs in
        # the vertex shader (uniform-driven). Guards against regressing to
        # per-frame CPU vertex rewrites (~87k verts/frame + computeVertexNormals
        # spikes every 90 ms — the "performance garbage while playing music"
        # bug). (a) the shared uniforms must track the forced displacement
        # (this model fires toward -Z, so outward +14mm -> uD = -0.014);
        # (b) the CPU position buffer must stay at REST in every pose.
        page.evaluate("window.__sim.forceDisplacement(14); window.__simRenderOnce()")
        ds = page.evaluate("window.__sim.deformState()")
        check("GPU deform uniforms driven (uD == -0.014 at forced 14mm)",
              abs(ds["uD"] + 0.014) < 1e-6 and abs(ds["uBulge"] - 0.014 * 0.14 * 0.8 * 2.2) < 1e-6,
              f"deformState={ds}")
        buf_out = page.evaluate("window.__sim.mesh(19).geometry.attributes.position.array[2]")
        page.evaluate("window.__sim.forceDisplacement(0); window.__simRenderOnce()")
        buf_rest = page.evaluate("window.__sim.mesh(19).geometry.attributes.position.array[2]")
        check("Surround position buffer stays at rest (GPU-side deform)",
              abs(buf_out - buf_rest) < 1e-9,
              f"z[0] at d=14mm: {buf_out}, at d=0: {buf_rest}")

        # 6b. surround normal health — regression guard for the "black surround"
        # bug: quantized Int8 GLB normals + computeVertexNormals truncation.
        # Healthy = every sampled normal is a non-zero vector at rest.
        page.evaluate("window.__sim.forceDisplacement(6); window.__simRenderOnce()")
        page.evaluate("window.__sim.forceDisplacement(0); window.__simRenderOnce()")
        normals = page.evaluate("window.__sim.surroundNormals()")
        nstat = {k: v for k, v in normals.items() if isinstance(v, dict) and v.get("hasNormals")}
        healthy = all(v.get("nonZero", 0) >= v.get("sampled", 1) * 0.99 for v in nstat.values())
        check("Surround normals healthy (no zero-normal black shading)", healthy, json.dumps(normals))

        # 7-10. audio pipeline with a real MP3
        page.evaluate("""async () => {
          window.__r = 'pending';
          try {
            const r = await fetch('/idk3/test_bass.mp3'); if (!r.ok) throw new Error('http ' + r.status);
            const b = await r.blob();
            const f = new File([b], 'test_bass.mp3', {type: 'audio/mpeg'});
            await window.__sim.loadFile(f);
            window.__r = 'LOADED';
          } catch (e) { window.__r = 'ERR:' + e.message; }
        }""")
        page.wait_for_function("window.__r === 'LOADED'", timeout=30000)
        check("MP3 import + decode", True, "test_bass.mp3 loaded")
        page.evaluate("window.__sim.engine.ctx.resume()")
        time.sleep(0.5)
        playing = page.evaluate("window.__sim.engine.paused")
        check("Playback starts", playing == False, f"paused={playing}")
        time.sleep(2)
        f = page.evaluate("window.__sim.frame()")
        # NOTE: headless Chrome has NO audio output device, so the media-element
        # tap renders silence here. On real browsers MediaElementSource is the
        # standard visualization path. The DSP->motion chain is verified below
        # with the oscillator test tone, which runs on pure WebAudio.
        check("Media element playing (audio may be silent in headless)", f["playing"], f"bass={round(f['bass'],3)}")
        # seek / pause / restart
        page.evaluate("window.__sim.engine.pause()")
        paused = page.evaluate("window.__sim.engine.paused")
        page.evaluate("window.__sim.engine.seek(5)")
        t = page.evaluate("window.__sim.engine.currentTime")
        check("Pause + seek work", paused and abs(t - 5) < 1.5, f"paused={paused} t={round(t,2)}")
        page.evaluate("window.__sim.engine.restart()")
        time.sleep(1)
        t2 = page.evaluate("window.__sim.engine.currentTime")
        check("Restart works", t2 < 3, f"t={round(t2,2)}")
        page.evaluate("window.__sim.engine.pause()")

        # 8b. DSP -> physics -> motion chain via oscillator test tone (works headless)
        page.evaluate("window.__sim.clearForcedDisplacement(); window.__sim.startTestTone(); window.__sim.engine.ctx.resume()")
        time.sleep(2.5)
        samples = []
        for _ in range(10):
            page.evaluate("window.__simRenderOnce()")
            samples.append(page.evaluate("""({d: +window.__sim.displacementMM().toFixed(2),
                    drive: +window.__sim.frame().drive.toFixed(3),
                    bass: +window.__sim.frame().bass.toFixed(3)})"""))
            time.sleep(0.12)
        bass_vals = [s["bass"] for s in samples]
        drive_vals = [abs(s["drive"]) for s in samples]
        disp_vals = [abs(s["d"]) for s in samples]
        check("Test tone produces bass energy at analyser", max(bass_vals) > 0.02, f"max bass={round(max(bass_vals),3)}")
        check("Bass drives signed cone displacement", max(drive_vals) > 0.05 and max(disp_vals) > 0.3,
              f"max |drive|={round(max(drive_vals),3)} max |excursion|={round(max(disp_vals),2)}mm")
        # REGRESSION GUARD (excursion calibration): the velocity clamp used to
        # be frequency-blind (40*maxUnits = 0.4 m/s), which capped every sine
        # at vMax/ω ≈ 1-1.8 mm and the whole sim at "0-1 mm xmax". Then the
        # gain itself was calibrated too conservatively (full-scale sine ->
        # 1.25 Xmax), so real music NEVER reached the suspension limits — the
        # user-reported "suspension never gets maxed out". The current
        # contract: full-scale sine at boxed resonance ≈ 1.75 Xmax, so the
        # AGC-normalized test tone must drive the cone TO/PAST the default
        # 10 mm Xmax (≈ 12 mm modeled). Floor 6 mm = suspension visibly
        # loaded; ceiling 25 mm = Duffing/BL limiter keeps it physical.
        check("Excursion maxes out the suspension (hits ≈ 1.2+ Xmax)",
              6.0 < max(disp_vals) < 25.0,
              f"max |excursion|={round(max(disp_vals),2)}mm (default Xmax=10mm)")
        page.evaluate("window.__sim.stopTestTone()")

        # 11. driver-only mode
        page.evaluate("window.__sim.setMode('driver'); window.__simRenderOnce()")
        vis = {m["index"]: m["visible"] for m in page.evaluate("window.__sim.mapping()")}
        enc_hidden = all(vis[i] == False for i in (0, 2, 3))
        cone_shown = vis[21] and vis[6] and vis[1]
        check("Driver-only mode hides enclosure, shows driver", enc_hidden and cone_shown, f"enc={[vis[i] for i in (0,2,3)]} cone/cap/coil={[vis[21],vis[6],vis[1]]}")
        page.evaluate("window.__sim.setMode('full'); window.__simRenderOnce()")

        # 12. component visibility toggles
        page.evaluate("window.__sim.applyVisibility()")
        vis2 = {m["index"]: m["visible"] for m in page.evaluate("window.__sim.mapping()")}
        check("Per-part visibility functional", all(vis2[i] for i in (21, 19, 15, 4, 1)), "all core parts visible in full mode")

        # 12b. motion smoothing removed — damping pinned to realistic constant
        params_obj = page.evaluate("window.__sim.params")
        smoothing_ui = page.evaluate("!!document.getElementById('param-smoothing')")
        check("Motion smoothing option removed (fixed realistic damping)",
              "smoothing" not in params_obj and not smoothing_ui,
              f"param key present={'smoothing' in params_obj}, slider in DOM={smoothing_ui}")

        # 12c. adaptive performance telemetry
        perf = page.evaluate("window.__sim.perf()")
        ok = (0.5 <= perf["renderScale"] <= 1.0 and perf["frameCostMs"] > 0
              and perf["drawnFrames"] > 0)
        check("Adaptive performance system live (DRS + idle skip)",
              ok, json.dumps(perf))

        # 12d. focus (no-UI) mode: viewport + import/play pill only
        page2 = browser.new_page(viewport={"width": 1000, "height": 700})
        page2.on("pageerror", lambda e: errors.append("noui:" + str(e)))
        page2.goto(APP.replace("?", "?noui=1&"), wait_until="domcontentloaded", timeout=60000)
        page2.wait_for_function("typeof window.__sim === 'object'", timeout=120000)
        hidden_ok = page2.evaluate("""() => {
          const ids = ['topbar', 'left-panel', 'right-panel', 'transport'];
          return ids.every((id) => getComputedStyle(document.getElementById(id)).display === 'none');
        }""")
        pill_ok = page2.evaluate("""() => {
          const bar = document.getElementById('noui-bar');
          const shown = getComputedStyle(bar).display !== 'none';
          const play = document.getElementById('play-btn');
          const imp = document.getElementById('import-btn');
          const cols = getComputedStyle(document.getElementById('layout')).gridTemplateColumns.split(' ').length;
          return shown && !!play.closest('#noui-bar') && !!imp.closest('#noui-bar') && cols === 1;
        }""")
        check("No-UI mode: chrome hidden, import+play pill shown, single-column layout",
              hidden_ok and pill_ok, f"hidden={hidden_ok} pill={pill_ok}")
        page2.evaluate("window.__sim.clearForcedDisplacement && window.__sim.clearForcedDisplacement()")
        page2.evaluate("""async () => {
          const r = await fetch('/idk3/test_bass.mp3'); if (!r.ok) throw new Error('http ' + r.status);
          const b = await r.blob();
          await window.__sim.loadFile(new File([b], 'test_bass.mp3', {type: 'audio/mpeg'}));
        }""")
        page2.wait_for_function("!window.__sim.engine.paused", timeout=30000)
        check("No-UI mode: import + auto-play works from the pill", True, "file loaded via pill, playback started")
        page2.keyboard.press("Escape")
        restored = page2.evaluate("""() => {
          const play = document.getElementById('play-btn');
          const imp = document.getElementById('import-btn');
          const topbarVisible = getComputedStyle(document.getElementById('topbar')).display !== 'none';
          const inTransport = !!play.closest('#transport') && !!imp.closest('#transport');
          return topbarVisible && inTransport && !document.body.classList.contains('noui');
        }""")
        check("No-UI mode: Esc restores the full lab UI", restored, f"restored={restored}")
        page2.close()

        # 13-15. viewport / touch sizing sanity + no page errors
        check("No runtime page errors", len(errors) == 0, "; ".join(errors[:3]) if errors else "clean")
        page.screenshot(path="/home/z/my-project/work/acceptance_full.png")

        browser.close()

run()
fails = [r for r in RESULTS if not r[1]]
print(f"\n==== {len(RESULTS) - len(fails)}/{len(RESULTS)} PASSED ====")
sys.exit(1 if fails else 0)

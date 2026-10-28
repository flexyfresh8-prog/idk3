# idk3 · Subwoofer Simulator

Interactive, audio-reactive subwoofer simulator that runs entirely in your browser.
Import an MP3 and watch the cone, rubber surround and voice coil respond to the bass in real time.

**Live:** https://flexyfresh8-prog.github.io/idk3/

Built with Vite + TypeScript + Three.js + Web Audio API. No backend, no uploads — all audio is processed locally.

## Features

- **Real GLB model, real mapping** — the model is audited at load time; every named component is bound by verified mesh identity (not index guesses). The mapping table is shown in the left panel.
- **Cone assembly motion** — cone + dust cap + voice coil move together along the driver's true axis, driven by a damped mass–spring model fed by low-frequency audio energy.
- **Three-part flexible surround** — the rubber roll (3 meshes) deforms procedurally: the inner edge follows the cone, the outer edge stays fixed to the frame, and the roll bends smoothly between them. No rigid translation, no fake scaling, exact recovery on stop.
- **Honest audio analysis** — Web Audio `AnalyserNode` with band-limited energy extraction (~20–200 Hz bass band by default, adjustable). High frequencies don't drive excursion; a 24 dB/oct low-pass tap plus RMS/peak smoothing keeps motion musical instead of twitchy.
- **Simulation parameters, clearly labeled** — every slider that affects the sim is marked `SIM`. This is an educational visualization: it does not compute real Thiele/Small parameters, force, or measured Xmax.
- **Two view modes** — complete subwoofer or driver-only, plus per-component visibility toggles and an isolation inspector.
- **Works on mobile** — touch camera controls, drawer panels, no horizontal overflow, iOS/Android file import.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

Deployment is automatic: pushes to `main` trigger `.github/workflows/deploy.yml`,
which builds with `tsc && vite build` and publishes `dist/` via GitHub Actions
(the repo's Pages source is set to "GitHub Actions").

## Project structure

```
src/
  main.ts             # bootstrap, GLB load, wiring
  core/
    gltfAudit.ts      # scene audit + mesh mapping verification
    assembly.ts       # moving assembly (cone + cap + coil)
    surroundDeform.ts # 3-part rubber roll deformation
    physics.ts        # damped mass-spring cone dynamics
    types.ts
  audio/
    audioEngine.ts    # playback, low-frequency analysis, test tone
  scene/
    stage.ts          # renderer, camera, lights, environment
    materials.ts      # studio material set
  ui/
    inspector.ts      # component list, visibility, isolation
    paramsPanel.ts    # simulation sliders
    playerUI.ts       # transport bar, meters, spectrum
```

## Note on scale

The GLB is an oversized art model (flange ≈ 1.10 m at natural scale); excursion
values are calibrated against that scale and remain user-defined simulation
parameters.

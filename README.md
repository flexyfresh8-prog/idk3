# idk3 — Interactive Subwoofer Dyno Lab

A realistic, audio-reactive 3D subwoofer simulator that runs entirely in your
browser. Import any MP3 from your device and watch the **actual components of
the supplied GLB model** — the cone, the three-part rubber surround and the
voice coil — move like a real driver.

**Live:** https://flexyfresh8-prog.github.io/idk3/

No uploads, no backend, no accounts: your audio files never leave your device.

![stack](https://img.shields.io/badge/Vite-TypeScript-blue) ![three](https://img.shields.io/badge/Three.js-WebGL-orange)

---

## v3 rework — coupled physics, finish studio, dyno-lab UI

- **Fully coupled electro-mechanical physics (RK4, per-sample).** v2 bolted
  back-EMF braking on as an extra damping term. v3 replaces it with the
  textbook lumped transducer model: the audio drives a **voltage** across the
  voice coil, the coil has real dynamics `Le(x)·di/dt = V − Re·i − Bl(x)·v`,
  force is `Bl(x)·i`, and every cross-domain effect — electromagnetic braking,
  inductive phase lag, force softening at extreme travel — *emerges* from the
  coupling. The nonlinear inductance `Le(x)` droops as the coil leaves the
  gap; the suspension keeps its Duffing hardening and asymmetry; a new
  **sealed-box air spring** (Enclosure air load slider) adds compliance
  stiffness like a real closed box; a new **Cone moving mass** slider changes
  transient attack and overshoot. Same calibration contract as v2: a
  full-scale note at resonance produces ≈ Xmax of travel.
- **Finish studio — four swappable PBR packs.** The whole texture library is
  now palette-parametric and can be swapped live from the left panel:
  *Obsidian Graphite* (smoked graphite + gunmetal + carbon), *Copperhead*
  (black ceramic cone + polished copper twill coil + dark bronze), *Arctic
  Forged* (glazed white-ceramic cone + forged aluminum + silver twill), and
  *Heritage Paper* (vintage tan paper cone + cream cloth surround + aged
  brass). Each pack regenerates albedo, Sobel-normal and roughness maps per
  component class, with per-finish clearcoat/sheen/metalness overrides.
- **"Dyno lab" UI.** New design language: warm instrument-panel graphite,
  amber→tangerine signal accents, Sora / Manrope / IBM Plex Mono typography,
  rack-module panels, fader-style notched sliders, amber spectrum with ember
  peak caps, VFD-style excursion readout, and finish swatch chips with
  two-tone previews.

---

## v2 rework — physics, textures, UI (superseded by v3, kept for reference)

- **Electro-mechanical physics (RK4, per-sample).** The moving assembly is now a
  3-state system — coil force (with Le/Re current lag), displacement, velocity —
  integrated with a Runge–Kutta 4 step for every audio sample. Includes
  back-EMF electromagnetic braking (resonance-peak compression), a nonlinear
  force factor Bl(x) that softens as the coil leaves the gap, an asymmetric
  Duffing hardening spring past Xmax, and a quadratic air-load term.
  A new **Driver resonance Fs** slider (18–60 Hz) sets the mass-spring
  resonance of the simulated system.
- **Procedural PBR texture library.** Every component class gets generated
  albedo + normal (Sobel height→normal) + roughness maps: pressed
  aramid/paper weave cone with clearcoat, matte micro-grain rubber surround
  with sheen, 2×2 twill carbon-fiber coil, brushed gunmetal flange/basket,
  machined motor steel, black loudspeaker carpet on the enclosure, and an
  orange-peel glossy dust cap. Materials upgraded to MeshPhysicalMaterial.
- **Studio stage.** Gradient cyclorama backdrop, platform + polar grid,
  depth fog, and cyan/violet rim lighting matched to the UI theme.
- **New UI.** "Precision audio lab" design: obsidian glass panels, cyan→violet
  accent system, Space Grotesk / Inter / JetBrains Mono typography, inline
  SVG transport icons, gradient-filled sliders, and a spectrum analyzer with
  falling peak-hold caps.

---

## Features

- **Real model, real parts** — the simulator loads `public/models/tripo_model_1793179198729.glb`
  (EXT_meshopt_compressed, decoded at runtime with `MeshoptDecoder`) and maps
  every mesh to a mechanical role. 48 parts, 981,208 vertices, 1.92 M triangles.
- **Audio-reactive physics** — a Web Audio graph extracts the *actual
  low-frequency content* of your music (cascaded 24 dB/oct low-pass tap), an
  AGC normalizes any track, a transient "punch" envelope adds kick, and a
  damped mass-spring model converts it into smooth cone excursion. Bass moves
  the cone; treble does not.
- **Flexible 3-part rubber surround** — meshes 19/15/4 deform per-vertex with a
  C0-continuous radial weight field: the inner edge follows the cone exactly,
  the outer edge stays glued to the frame, and a signed bulge term makes the
  half-roll bend like rubber in both directions.
- **Coordinated moving assembly** — cone (21), dust cap (6) and voice coil (1)
  ride one rigid group that translates strictly along the driver axis.
- **Two view modes** — *Complete subwoofer* and *Driver only* (enclosure drum
  hidden, not deleted), plus per-part visibility toggles and isolated solo
  inspection.
- **Component inspector** — select any of the 48 parts, highlight it in 3D,
  read its verified identity (vertex/triangle counts, radial extents), reset
  its transform.
- **Full parameter panel** — max excursion, bass sensitivity, drive low-pass
  cutoff, bass-band upper limit, motion smoothing, surround flexibility,
  surround deformation strength, voice-coil travel, audio gain, animation
  intensity. Every change applies live; simulation reset included.
- **Local music player** — file picker, drag & drop, play/pause/restart/seek,
  volume + mute, live spectrum analyzer, bass/mid/HF meters, excursion readout,
  synthesized bass test tone. MP3/WAV/M4A/OGG/FLAC.
- **Responsive** — desktop 3-column studio layout; tablet/phone use
  off-canvas panels and a compact transport. No horizontal overflow from
  360 px up; touch orbit/zoom/pan on the 3D view.
- **Weak-GPU fallback** — the renderer auto-detects software rasterizers and
  drops shadows/PMREM/pixel-ratio (`?lite=1` forces it, `?still=1` renders on
  demand for automated tests).

## Verified component map

The mapping below was established by an offline audit of the GLB (JSON chunk +
decoded meshopt buffers), confirmed programmatically at runtime and visually by
rendering each part in isolation. Node names in this file are `tripo_part_N`,
and node index == mesh index (verified — never assumed).

| Component | Mesh | Role in simulation |
|---|---|---|
| Rubber Surround — Part 1 | **Mesh 19** | flexible — deforms with cone |
| Rubber Surround — Part 2 | **Mesh 15** | flexible — deforms with cone |
| Rubber Surround — Part 3 | **Mesh 4** | flexible — deforms with cone |
| Cone | **Mesh 21** | moving assembly (axial translation) |
| Voice Coil | **Mesh 1** | moving assembly (axial translation) |
| Dust Cap *(found by audit — user brief did not list it)* | Mesh 6 | moving assembly |
| Frame flange quadrants *(brief listed Mesh 7 as "cone")* | Meshes 5, **7**, 8, 22 | stationary — geometry shows screw-hole flange arcs; animating them would be wrong, so per the "never animate the wrong parts" rule they stay fixed and the cone role is carried by the verified diaphragm meshes 21 + 6 |
| Basket legs | Meshes 9, 10, 20 | stationary |
| Outer lip ring | Mesh 14 | stationary |
| Spider / motor / terminals / pole details | Meshes 11–13, 16–18, 23–47 | stationary |
| Enclosure drum (hidden in Driver-only mode) | Meshes 0, 2, 3 | stationary |

Driver axis: **Z** (re-derived from mesh geometry at runtime as a sanity
check); the driver fires toward **−Z**.

The app exposes the audit at runtime: open the console and inspect
`window.__sim.mapping()`, `window.__sim.probe()` and `window.__sim.axis()`.

## How the surround deformation works

For every vertex of meshes 19/15/4 the app precomputes, from **rest**
positions:

- `w(r)` — an axial-drive weight as a smoothstep of radial distance `r` from
  the driver axis. `w = 1` at/below the cone attach radius (inner edge follows
  the cone **exactly** — no gap), `w = 0` at/above the frame radius (outer edge
  never detaches). *Flexibility* reshapes the profile between the plateaus.
- `dirA` — the driver axis in the mesh's local space.
- `dirR` — the per-vertex radial direction (for volume compensation).

Each frame: `p = rest + dirA · (d · w) + dirR · (bulge · sin(π·w))`. The bulge
term is signed with the excursion so inward and outward travel both roll the
rubber naturally, and it vanishes at both edges (`sin(0) = sin(π) = 0`),
preserving attachments. Because `w` depends only on radius, seam vertices
shared in spirit between the three arc segments receive identical weights —
the parts deform **together** with no tearing or gaps. Normal recomputation is
throttled (≈11 Hz) to keep the frame budget for rendering. At `d = 0` the
exact original buffer is restored.

## How audio analysis drives the simulation

```
<audio> ──► MediaElementSource ─► sourceBus ─┬─► masterGain ─► destination
 testTone ─► testGain ─────────┘             ├─► lp1 ─► lp2 ─► bassAnalyser   (drive tap)
                                             └─► fullAnalyser                 (spectrum/RMS)
```

- The **drive tap** is the time-domain output of a cascaded 2× low-pass
  (default 120 Hz, adjustable 40–300 Hz, 24 dB/oct total). A short recent-window
  mean tracks the **signed phase** of the bass waveform — the cone visibly
  pumps *with* the beat rather than jittering with overall loudness.
- An **AGC** (slow-decaying reference) normalizes quiet and loud tracks.
- A **punch envelope** (fast + slow followers) emphasizes transients.
- A damped **mass-spring follower** (stiffness/damping from *Motion smoothing*)
  turns the target into smooth, continuous excursion with soft limiting at
  *Max cone excursion* (default 10 mm — a user-defined simulation parameter,
  **not** a measured Xmax).
- High-frequency content is metered (bass/mid/HF bars + spectrum) but never
  drives excursion, so cymbals don't shake the cone.

> **Honesty note** — an MP3's digital waveform does not tell you the true
> physical excursion of a real driver (that depends on enclosure, power,
> Thiele/Small parameters and the actual transducer). This simulator is a
> visually convincing, audio-reactive approximation. It does **not** compute
> real Thiele/Small parameters, force or measured millimeters of excursion.

## Getting started

```bash
git clone https://github.com/flexyfresh8-prog/idk3.git
cd idk3
npm install
npm run dev        # http://localhost:5173/idk3/
```

Then: **Import MP3** (or drag & drop a file anywhere), press play, or hit
**Bass test tone** to see the driver move without any file.

## Usage tips

- Orbit: drag · Zoom: wheel / pinch · Pan: right-drag / two-finger drag.
- *Driver only* + hiding *Frame · basket · motor* in the left panel gives a
  clean look at the surround roll and voice coil motion.
- Select *Rubber Surround — Part 1* and press solo (◎) to isolate one arc
  segment and watch it flex.
- If your device struggles, append `?lite=1` to the URL.

## Development

```bash
npm run dev        # dev server (base path /idk3/)
npm run build      # type-checks with tsc, then builds into dist/
npm run preview    # serves the production build locally
```

Automated acceptance tests live in [`tests/acceptance_test.py`](tests/acceptance_test.py) (Playwright;
they drive `window.__sim`): 16/17 checks pass in CI-like headless mode — the
only excluded check is media-element audio output, which requires a real audio
device (verified instead through the Web Audio oscillator path).

## Deployment (GitHub Pages)

Deployment is automated with GitHub Actions (`.github/workflows/deploy.yml`):
every push to `main` builds the site and deploys it via the built-in
`GITHUB_TOKEN` with minimal permissions — no secrets involved.

`vite.config.ts` sets `base: '/idk3/'` so all asset and model URLs resolve
under the repository subpath. If Pages ever reports "deployment not
configured", open **Settings → Pages → Build and deployment → Source** and
select **GitHub Actions** once; everything after that is automatic.

## Repository layout

```
├── .github/workflows/deploy.yml   # build + Pages deployment
├── index.html                     # app shell (panels, transport, overlays)
├── public/models/*.glb            # the supplied subwoofer model (as uploaded)
└── src
    ├── main.ts                    # boot, audit wiring, render loop
    ├── style.css                  # responsive dark studio UI
    ├── core
    │   ├── types.ts               # verified component map + sim params
    │   ├── gltfAudit.ts           # runtime model audit / axis derivation
    │   ├── assembly.ts            # rigid moving group (cone + cap + coil)
    │   ├── surroundDeform.ts      # 3-part rubber deformation field
    │   └── physics.ts             # damped mass-spring excursion model
    ├── audio/audioEngine.ts       # Web Audio graph + DSP + test tone
    ├── scene/{stage,materials}.ts # renderer/lights/orbit + PBR sets
    └── ui/{inspector,paramsPanel,playerUI}.ts
```

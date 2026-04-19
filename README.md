# Charge Radiation Sandbox

An interactive visualizer for electromagnetic fields produced by moving point charges, using exact Liénard-Wiechert potentials. Watch causality in action: fields depend on where the charge *was* when it emitted the signal, not where it is now.

---

## What you will learn

After a few minutes of exploration you should be able to see and understand:

- **Retarded time and causality** — field changes propagate outward at speed c; lower c to make the delay visible
- **Velocity field** — Coulomb-like, always present, decays as 1/R²; points toward where the charge appears headed
- **Acceleration field (radiation)** — only appears during acceleration, decays as 1/R; dominates at large distances
- **Radiation shell** — stop a moving charge suddenly and watch a shell of radiation expand outward at c, separating the "old" field from the "new"
- **Relativistic beaming** — a fast-moving charge concentrates its field in the forward direction
- **Dipole radiation** — continuous sinusoidal acceleration produces expanding wave trains, just like an antenna

---

## How to use the app

### Starting up

When you open the app you will see a **start panel** with three mode cards. Click any card to begin — the simulation seeds immediately and the panel clears. You can return to this screen at any time with the **← Start screen** button in the Mode section of the control panel.

### The control panel

A floating panel in the upper-left corner gives you all controls:

| Section | What it does |
|---------|-------------|
| **Mode** | Switch between the three demo modes (see below). Switching reseeds the simulation cleanly. **← Start screen** — return to the mode-picker panel and reset all settings to defaults (including c). |
| **Playback** | **Run / Pause** — toggle real-time playback. **Step →** — advance one frame at a time while paused. **Reset** — restart the current mode from t=0, keeping your field layer and overlay choices. |
| **Speed of light** | Drag the slider to change c (max 3.0). The lower bound is mode-dependent: 0.62 in Oscillating, 0.72 in Moving charge (the GPU history buffer must cover the causal horizon), and 0.65 in Charge at rest. Lowering c slows all field propagation, making retarded-time effects dramatically visible. |
| **Field** | Toggle which component of E you see: **Total E** (default), **Velocity E** (Coulomb-like term), or **Accel E** (radiation term only). |
| **Overlays** | See the Overlays section below. |
| **Camera** | Reset view, zoom ±, and pan arrows. You can also scroll-to-zoom and right/middle-drag to pan directly on the canvas. |
| **Field at cursor** | When your cursor is over the canvas, shows the instantaneous field components at that point: \|E\|, Ev, Ea, Bz. |

### Camera controls

| Action | How |
|--------|-----|
| Zoom | Scroll wheel (centered on cursor) or ± buttons in the panel |
| Pan | Right-drag or middle-drag; or arrow buttons in the panel |
| Reset view | "Reset view" button in the panel |

---

## Demo modes

### Charge at rest

A single stationary charge produces a pure Coulomb field — radial arrows, magnitude falling as 1/R². The acceleration field is identically zero.

**To try:** Click **Run** and drag the charge. Every time you accelerate it you create a radiation pulse — visible as a kink that moves outward. Switch to **Accel E** to isolate just the radiation term. Try a quick jerk versus a slow drag and compare the pulse shapes.

### Moving charge

A charge moves at constant velocity. While moving, its field shows relativistic beaming — compressed forward, expanded backward. Click **Stop now** (in the mini panel that appears near the charge) to brake the charge and launch a radiation shell. The shell expands outward at c. Inside: a pure Coulomb field from the stationary charge. Outside: the field still points toward where the charge would have been if it hadn't stopped.

**To try:**
- Lower c before clicking Stop so the shell is easy to see at normal zoom.
- Enable the **Radiation heatmap** to see where the radiated energy is concentrated.
- Toggle **Ghost charge** in the mini panel — a marker appears at the would-have-been position so the outside-of-shell field makes sense.
- Enable **Field lines** (while paused) and then **Ghost field lines** in the mini panel to compare the inside and outside field geometries side by side.
- Enable **Wavefront contours** to see the envelope contour marking the shell boundary.

### Oscillating charge

A charge oscillates sinusoidally along one axis, radiating continuously. The field shows the characteristic dipole pattern: strongest perpendicular to the motion, weaker along the axis. The wavefronts expand outward at c.

**To try:**
- Enable **Radiation heatmap** to map the radiated field intensity.
- Enable **Wavefront contours** to see zero-crossing lines that track the wave phase exactly.
- Lower c until you can see the wavefronts expanding in real time.
- Pause and enable **Field lines** to see the instantaneous field geometry.

---

## Teaching overlays

All overlays are off by default. They stack freely — you can enable any combination.

| Overlay | Where | What it shows |
|---------|-------|---------------|
| **Field lines** | All modes, when paused | Instantaneous streamlines of the total electric field at the paused frame. Not material lines that move with the charge — they are a snapshot of the field at that moment. |
| **Radiation heatmap** | Moving charge, Oscillating | Color map of the radiation magnetic field (Bz from the acceleration term). Warm/orange = positive phase, cool/blue = negative phase in oscillating; envelope intensity in moving charge. |
| **Wavefront contours** | Moving charge, Oscillating | Contour lines computed directly in the GPU shader, always aligned with the heatmap. In Oscillating: zero-crossing lines tracking wave phase. In Moving charge: envelope threshold contour marking the shell boundary. |
| **Ghost charge** (mini panel) | Moving charge | A marker at the extrapolated would-have-been position after the stop. Shows why the field outside the shell still points toward a charge that is no longer there. |
| **Ghost field lines** (mini panel) | Moving charge, paused | Streamlines of the extrapolated constant-velocity field — shows what the field would look like if the charge had never stopped. |

---

## Getting started (developers)

```bash
npm install
npm run dev      # start dev server with hot reload at http://localhost:5173
npm test         # run physics unit tests (Vitest) — 169 tests across 10 suites
npm run lint     # ESLint on all source files
npm run build    # TypeScript strict type-check + Vite production build
```

### Architecture

Three layers with hard dependency rules:

```
src/physics/     — pure TypeScript, zero React imports, fully unit-tested
src/rendering/   — pure functions, no canvas/DOM side effects
src/components/  — React components, owns canvases and interaction hooks
```

Key design decisions:

- **Analytical over numerical** — exact Liénard-Wiechert potentials, not FDTD grid solvers
- **History-driven** — `ChargeHistory` is the single source of truth for all charge kinematics; the retarded-time solver reads from it at evaluation time
- **c is always a parameter** — the speed of light is never hardcoded; slowing it down is a first-class feature
- **Ref-based live state** — animation-frame loops read from `useRef` values; React state drives only the control panel UI

### Source files

**`src/physics/`** — pure TypeScript, no React

| File | Purpose |
|------|---------|
| `types.ts` | Core types: `Vec2`, `KinematicState`, `SimConfig`, `RetardedSolveResult`, `LWFieldResult` |
| `vec2.ts` | 2D vector math helpers |
| `chargeHistory.ts` | Per-charge kinematic history buffer: circular storage, binary-search interpolation, time-window pruning |
| `retardedTime.ts` | Retarded-time root-finder: fixed-point iteration (max 15 steps), graceful fallback |
| `lienardWiechert.ts` | Exact LW field evaluator: velocity term (1/R²) + acceleration term (1/R) + B field decomposition |
| `demoModes.ts` | Analytical kinematics for each demo mode; `sampleSuddenStopState` for interactive braking; braking substep helper for radiation-shell sharpness |
| `dragKinematics.ts` | Tick-owned drag kinematics: EMA smoothing, zero-motion guard, speed cap |
| `wavefrontSampler.ts` | Coarse scalar sampler for `bZAccel` with per-cell retarded-time warm-starting (CPU fallback path) |
| `streamlineTracer.ts` | RK4 streamline tracer for paused-frame field-line overlays; ghost-angle numeric solver for moving-charge ghost lines |

**`src/rendering/`** — pure functions, no DOM

| File | Purpose |
|------|---------|
| `worldSpace.ts` | World↔canvas coordinate transforms, view-bounds helpers, history-horizon geometry |
| `arrows.ts` | Field magnitude → visual weight mapping, orange→hot-yellow color palette, arrow geometry |
| `chargeMarker.ts` | Shared visual radius constant for the charge dot |
| `chargeHitTest.ts` | Hit-test helper for drag start |
| `wavefrontRender.ts` | CPU-path wavefront rendering helpers: dynamic-range compression, bilinear upscaling, heatmap image generation, contour extraction |
| `wavefrontWebGLConfig.ts` | Per-mode c-slider minimum constants and `minCForMode()` accessor (Policy A conservative bounds) |
| `webglUtils.ts` | WebGL setup utilities: `compileShader`, `createShaderProgram`, `createFloat32Texture`, `createFullscreenQuad` |

**`src/components/`** — React components and hooks

| File | Purpose |
|------|---------|
| `ChargeRadiationSandbox.tsx` | Root orchestrator: simulation RAF tick, charge history, demo/display state, drag handling, camera wiring |
| `StartPanel.tsx` | Home screen overlay shown on initial load and after Reset; mode cards serve as navigation |
| `ControlPanel.tsx` | Floating glass panel: mode selector, playback controls, c slider, field layer toggles, overlay toggles, cursor readout |
| `MovingChargeMiniPanel.tsx` | Draggable mini panel for moving-charge controls: Stop now trigger, ghost-charge and ghost-field-lines toggles |
| `VectorFieldCanvas.tsx` | 40×40 arrow grid, ghost charge overlay, continuous RAF loop, DPR-aware canvas |
| `WavefrontWebGLCanvas.tsx` | WebGL2 fragment-shader heatmap: full-screen quad, RGBA32F history texture, bracketed Newton retarded-time solver in GLSL |
| `WavefrontOverlayCanvas.tsx` | CPU fallback heatmap + contour canvas (active when WebGL2 / RGBA32F is unavailable) |
| `StreamlineCanvas.tsx` | Paused-frame field-line overlay; traces main and ghost streamlines on demand; clears during playback |
| `useSandboxCamera.ts` | Pan/zoom hook: RAF-batched state updates, zoom-about-cursor, world↔screen transform plumbing |
| `useCursorReadout.ts` | Canvas-scoped hover listeners, RAF-batched LW field evaluation at cursor position |

### Stack

- **Build:** Vite + `@vitejs/plugin-react`
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`) — all UI components use Tailwind utility classes; `src/index.css` is the single CSS entry point
- **Import alias:** `@/` maps to `src/` — use `@/physics/types`, `@/rendering/worldSpace`, etc. for cross-directory imports; `./` for same-directory

### Reference docs

| File | What it covers |
|------|---------------|
| `IDEAS.md` | Liénard-Wiechert math, retarded-time derivation, why FDTD was ruled out |
| `IDEAS-wavefronts.md` | Design rationale and extended spec for the M6 sampled wavefront overlay |
| `IDEAS-webGL.md` | Full design spec for the WebGL renderer: data model, texture packing, solver design, c-slider policy |
| `SPEC.md` | Milestone definitions and acceptance criteria |
| `AGENTS.md` | Code style, naming conventions, and architectural constraints |

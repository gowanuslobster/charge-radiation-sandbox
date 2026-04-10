# Charge Radiation Sandbox

An interactive visualizer for electromagnetic fields produced by moving point charges, using exact Liénard-Wiechert potentials. Watch causality in action: fields depend on where the charge *was* when it emitted the signal, not where it is now.

## What you will be able to learn

After a few minutes of exploration you should be able to see and understand:

- **Retarded time and causality** — field changes propagate outward at speed c; slow c down to make the delay visible
- **Velocity field** — Coulomb-like, always present, decays as 1/R²
- **Acceleration field (radiation)** — only appears during acceleration, decays as 1/R, and can outrun the Coulomb field at large distances
- **Radiation shell** — stop a moving charge suddenly and watch a shell of radiation expand outward at c
- **Relativistic beaming** — a fast-moving charge concentrates its field in the forward direction
- **Superposition** — multiple charges produce fields that add linearly

## Planned demo modes

| Mode | What to look for |
|------|-----------------|
| Charge at Rest | Pure Coulomb field; radial arrows, 1/R² decay. Drag the charge to create radiation pulses. |
| Moving charge | Constant-velocity beaming; trigger the stop to launch a Bremsstrahlung radiation shell |
| Oscillating charge | Dipole radiation pattern |

These modes arrive across M2–M5. See `SPEC.md` for the full milestone schedule.

## Current status

**M5 complete — speed of light slider, interactive sudden stop, ghost overlay, oscillating mode, cursor readout.** The app renders an interactive electromagnetic field visualizer with four demo modes. Pan with right-drag or middle-drag, zoom with the scroll wheel. In Charge at Rest mode, left-drag the charge to produce radiation pulses directly.

What is implemented and tested:

- `src/physics/types.ts` — core types: `Vec2`, `KinematicState`, `SimConfig`, `RetardedSolveResult`, `LWFieldResult`
- `src/physics/vec2.ts` — 2D vector math helpers
- `src/physics/chargeHistory.ts` — per-charge kinematic history buffer with binary-search interpolation and pruning
- `src/physics/retardedTime.ts` — retarded-time root-finder (fixed-point iteration, max 15 steps, graceful fallback)
- `src/physics/lienardWiechert.ts` — exact LW field evaluator: velocity term (1/R²) + acceleration term (1/R) + B field
- `src/physics/demoModes.ts` — analytical kinematics for each demo mode; `sampleSuddenStopState` for interactive braking; substep helper for shell sharpness
- `src/physics/dragKinematics.ts` — tick-owned drag kinematics: EMA smoothing, zero-motion guard, speed cap
- `src/rendering/worldSpace.ts` — world↔canvas coordinate transforms, view-bounds helpers, history-horizon geometry
- `src/rendering/arrows.ts` — field magnitude → visual weight mapping, orange→hot-yellow palette, arrow geometry
- `src/rendering/chargeMarker.ts` — shared visual radius constant for the charge marker
- `src/rendering/chargeHitTest.ts` — hit-test helper for drag start
- `src/components/useSandboxCamera.ts` — pan/zoom hook with RAF-batched state updates and zoom-about-cursor
- `src/components/useCursorReadout.ts` — canvas-scoped hover listeners, RAF-batched LW field evaluation at cursor position
- `src/components/VectorFieldCanvas.tsx` — 40×40 arrow grid, ghost charge overlay, continuous RAF loop, DPR-aware canvas
- `src/components/ChargeRadiationSandbox.tsx` — simulation tick, seeding, drag handling, camera wiring, M5 control handlers
- `src/components/ControlPanel.tsx` — mode selector, playback controls (play/pause/step/reset), c slider, field layer toggles, mode-specific controls, teaching overlays, cursor readout display

**Implemented demo modes:** charge at rest (pure Coulomb field; drag to produce radiation), moving charge (relativistic beaming; interactive stop trigger launches Bremsstrahlung shell; ghost overlay), oscillating charge (continuous dipole radiation pattern).

**Implemented controls:** demo mode toggle (3 modes), field-layer toggle (Total E / Velocity E / Acceleration E), play/pause/step/reset, speed-of-light slider (c = 0.65–3.0), moving-charge mini panel (Stop now trigger, ghost charge overlay toggle), cursor field readout, pan, zoom.

## Getting started (developers)

```bash
npm install
npm run dev      # start dev server with hot reload
npm test         # run physics unit tests (Vitest)
npm run lint     # ESLint on all source files
npm run build    # TypeScript strict build
```

### Architecture

The target layout is three layers with hard dependency rules:

```
src/physics/     — pure TypeScript, zero React imports, fully unit-tested   [exists]
src/rendering/   — pure functions, no canvas/DOM                            [exists]
src/components/  — React components, owns canvases and interaction hooks    [exists]
```

Key design decisions:

- **Analytical over numerical** — exact Liénard-Wiechert potentials, not FDTD grid solvers
- **History-driven** — `ChargeHistory` is the single source of truth for all charge kinematics; the retarded-time solver reads from it
- **c is always a parameter** — the speed of light is never hardcoded; slowing it down is a first-class feature
- **Ref-based live state** — animation-frame loops will read from refs; React state drives only the control panel UI

### Stack

- **Build:** Vite + `@vitejs/plugin-react`
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`) — all UI components use Tailwind classes; `src/index.css` is the single CSS entry point
- **Import alias:** `@/` maps to `src/` — use `@/...` for cross-directory imports (e.g., `@/physics/types`), `./...` for same-directory imports

### Reference docs

- `IDEAS.md` — Liénard-Wiechert math, retarded-time derivation, and why FDTD was ruled out
- `SPEC.md` — milestone definitions and acceptance criteria
- `AGENTS.md` — code style, naming conventions, and architectural constraints

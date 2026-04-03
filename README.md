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
| Stationary charge | Pure Coulomb field; radial arrows, 1/R² decay |
| Uniform velocity | Beamed field, no radiation shell |
| Sudden stop (Bremsstrahlung) | Expanding radiation shell at c; distinct inside/outside regions |
| Oscillating charge | Dipole radiation pattern |
| Draggable charge | Accelerate by dragging; radiation pulses appear as you move |

These modes arrive across M2–M5. See `SPEC.md` for the full milestone schedule.

## Current status

**M1 complete — physics core only.** The app currently renders a placeholder screen; no visualization or interaction UI exists yet.

What is implemented and tested:

- `src/physics/types.ts` — core types: `Vec2`, `KinematicState`, `SimConfig`, `RetardedSolveResult`, `LWFieldResult`
- `src/physics/vec2.ts` — 2D vector math helpers
- `src/physics/chargeHistory.ts` — per-charge kinematic history buffer with binary-search interpolation and pruning
- `src/physics/retardedTime.ts` — retarded-time root-finder (fixed-point iteration, max 15 steps, graceful fallback)
- `src/physics/lienardWiechert.ts` — exact LW field evaluator: velocity term (1/R²) + acceleration term (1/R) + B field

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
src/rendering/   — pure functions, no canvas/DOM                            [M2]
src/components/  — React components, owns canvases and interaction hooks    [M2+]
```

Only `src/physics/` is meaningfully established. `src/rendering/` does not exist yet, and `src/components/` is still placeholder Vite scaffolding.

Key design decisions:

- **Analytical over numerical** — exact Liénard-Wiechert potentials, not FDTD grid solvers
- **History-driven** — `ChargeHistory` is the single source of truth for all charge kinematics; the retarded-time solver reads from it
- **c is always a parameter** — the speed of light is never hardcoded; slowing it down is a first-class feature
- **Ref-based live state** — animation-frame loops will read from refs; React state drives only the control panel UI

### Reference docs

- `IDEAS.md` — Liénard-Wiechert math, retarded-time derivation, and why FDTD was ruled out
- `SPEC.md` — milestone definitions and acceptance criteria
- `AGENTS.md` — code style, naming conventions, and architectural constraints

# AGENTS.md

## Overview

This is **Charge Radiation Sandbox** — an interactive 2D visualizer for electromagnetic fields and radiation produced by moving point charges, using the exact Lienard-Wiechert (LW) potentials.

Students explore:

- retarded-time causality (fields depend on where the charge *was*, not where it *is*)
- velocity fields (Coulomb-like, 1/R^2 decay) vs. acceleration fields (radiation, 1/R decay)
- how accelerating charges produce electromagnetic radiation pulses
- the relationship between charge motion, field structure, and energy flow

The app is a self-contained **React + TypeScript** frontend built with Vite. There is no backend, database, or Docker setup involved in normal development.

This project is a sibling to `field-sandbox` (electrostatics) and `wave-optics-sandbox` (FDTD waves). It shares their pedagogical goals and UI philosophy but uses a fundamentally different physics engine: analytical Lienard-Wiechert fields computed from particle history buffers, not grid-based solvers. For the mathematical framework and physics rationale, see `IDEAS.md`. For milestones, acceptance criteria, and official project scope, see `SPEC.md`.

## Runbook

- **Dev server:** `npm run dev`
- **Lint:** `npm run lint`
- **Tests:** `npm test`
- **Build:** `npm run build`

## Actual stack and architecture

- **Framework:** React + TypeScript, bundled with Vite
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite`, with `src/index.css` as the single CSS entry point
- **Physics core:** Lienard-Wiechert field solver with per-charge history buffers under `src/physics/`
- **Primary rendering (Path A):** Canvas 2D vector grid — CPU-based retarded-time root-finder, renders field arrows over a sampled grid
- **Future rendering (Path B):** WebGL fragment shader — GPU-parallel retarded-time solve and LW evaluation per pixel
- **Dynamic overlays:** HTML canvas layers for vector field, charge positions, retarded-position markers, light cones, and particle trails

Important notes:
- Do not assume Shadcn UI, Framer Motion, or a generic design system is present.
- Most simulation, rendering, and interaction logic is custom and performance-sensitive.
- React should not own the live simulation state or history buffers.

**Banned approaches and libraries:**
- Do not write grid-based FDTD solvers or Yee-grid update loops. This project uses analytical Lienard-Wiechert potentials, not discretized Maxwell's equations.
- Do not install physics engines like `Matter.js`, `Box2D`, or `cannon-js`. All kinematics are custom.
- Do not install UI component frameworks like `Shadcn`, `Chakra`, or `Framer Motion` unless instructed.

## Visual and interaction consistency with field-sandbox

This project should look and feel like a member of the same family as `field-sandbox`. A student who has used field-sandbox to explore electrostatics should find the interaction model, visual style, and panel layout immediately familiar here.

### field-sandbox is the visual gold standard

**`field-sandbox` is the authoritative reference for all visual and interaction decisions in this project.** When implementing any visual feature — arrow geometry, glow/blur curves, alpha curves, color palettes, canvas draw calls, control panel layout, camera behavior — match `field-sandbox` as closely as the code will allow.

Deviate from field-sandbox only when:
- The physics or architecture genuinely requires it (e.g., this project uses world-space grid spacing rather than fixed screen-space spacing, so arrow length must be capped relative to the world-space grid cell rather than being a fixed pixel value), or
- A profiling measurement shows the field-sandbox approach causes unacceptable performance regression on this project's physics workload.

When a deviation is made, document it in a code comment explaining why.

If field-sandbox cannot be accessed directly, `wave-optics-sandbox` is the secondary reference. Do not invent a new visual approach when a working one exists in either sibling project.

### General principle

Wherever this project implements a feature that has an analogue in field-sandbox (camera, charge manipulation, vector rendering, field-line / streamline overlays, control panel, cursor readout), match the UX behavior and code organization. Do not invent a new interaction pattern when a working one already exists in the sibling project.

### Reference files (for agents that can access the field-sandbox repo)

If you have access to the `field-sandbox` codebase (located at `../field-sandbox/` relative to this repo), consult these files as the source of truth for visual and interaction patterns:

| Pattern | Reference file |
|---------|---------------|
| Arrow rendering style | `field-sandbox/src/components/VectorFieldCanvas.tsx` |
| WebGL heatmap and color palette | `field-sandbox/src/components/FieldHeatmap.tsx` |
| Floating control panel layout | `field-sandbox/src/components/FieldSandboxControlPanel.tsx` |
| Pan/zoom camera model | `field-sandbox/src/components/useSandboxCamera.ts` |
| Pointer-driven charge repositioning | `field-sandbox/src/components/useChargeDragging.ts` |
| Hover field readout | `field-sandbox/src/components/useCursorReadout.ts` |
| Drag-to-launch interaction | `field-sandbox/src/components/useSlingshotInteraction.ts` |
| Vector2D / Vector2Like patterns | `field-sandbox/src/physics/vector2d.ts` |

**CRITICAL IMPORT RULE:** You may *read* these files for reference if your tooling allows, but you MUST NOT write import statements that point outside the `charge-radiation-sandbox` repository. All shared logic must be duplicated or rewritten natively inside this project. Do not link to `../field-sandbox`.

### Inline pattern descriptions (for agents without cross-repo access)

If you cannot access field-sandbox directly, follow these concrete patterns:

- **Arrow rendering:** match the arrow style from `field-sandbox/src/components/VectorFieldCanvas.tsx` as closely as possible. Do not change arrow geometry, color palette, glow curves, or visual weight formulas unless specifically asked to do so.
- **Color palette:** dark background (near-black). Orange tones for positive / strong field regions, blue tones for negative / weak regions. Consistent with the electrostatics sibling project.
- **Control panel:** match the visual style of `field-sandbox/src/components/FieldSandboxControlPanel.tsx` as closely as possible — panel shape, button look, font size, label style, and brightness. Do not change control panel styling unless specifically asked to do so.
- **Camera model:** scroll-to-zoom centered on the cursor position, right-drag or middle-drag to pan. World-to-screen and screen-to-world coordinate transforms are centralized in a single module or hook, not scattered across components.
- **Charge interaction:** left-drag to reposition charges. Visual feedback during drag (e.g., the charge follows the pointer smoothly). Position updates are `requestAnimationFrame`-batched, not committed to React state on every raw `pointermove`.
- **Cursor readout:** hovering over the canvas shows local field values (E magnitude, individual components, or B). The readout is RAF-batched to avoid triggering React renders on every pointer event.

## Physics and numerics rules

- **Field model:** Lienard-Wiechert potentials — the exact, analytical solutions to Maxwell's equations for point charges in 3D vacuum, projected into a 2D observation plane.
- **Retarded time:** the implicit equation `t_ret = t - |r - r_s(t_ret)| / c` must be solved iteratively for each observation point. Use a convergent fixed-point or Newton iteration with a hard iteration cap (e.g., `MAX_ITERATIONS = 15`) and a fallback to the best available guess. If convergence fails — which can happen near singularities or when a charge is dragged violently — the solver must return a usable result rather than spinning indefinitely. Never use an uncapped `while` loop for root-finding.
- **Field decomposition:** always maintain the clean split between the velocity field (near-field / Coulomb, 1/R^2 decay) and the acceleration field (far-field / radiation, 1/R decay). These are conceptually and pedagogically distinct — do not merge them into a single opaque calculation.
- **Magnetic field:** derive B from the cross product `B = (1/c) * n_hat x E` evaluated at the retarded time. Do not compute B independently.
- **Units and the speed of light:** prefer normalized units. However, the speed of light (`c`) must be treated as a configurable parameter passed into the solver and the history buffer, not a hardcoded global constant. Pedagogically, we need the ability to lower `c` to exaggerate retarded-time causality delays for the student. When `c` changes, the history buffer's pruning window (light-crossing time of the visible domain) must update accordingly. If the user dynamically lowers `c`, the required retarded-time lookup might suddenly exceed the available history buffer. Handle this boundary gracefully (e.g., clamp to the oldest available state) rather than throwing an array out-of-bounds error.
- **Coordinate systems:** the physics engine (`src/physics/`) must use standard Cartesian coordinates (+X right, +Y up). The rendering layer (`src/components/` and `src/rendering/`) must handle the conversion to HTML Canvas coordinates (+X right, +Y down). Never leak screen coordinates into the physics history buffers.
- **History buffer:** the engine must maintain a continuous time-stamped history of every charge's position, velocity, and acceleration. Prune old entries beyond the light-crossing time of the visible domain to prevent memory leaks.
- **Interpolation:** use at minimum linear interpolation in the history buffer for retarded-time lookups. If higher-order interpolation (cubic, Hermite) is introduced, label it clearly in comments.
- **Singularity guards:** use Plummer softening or equivalent near-source regularization to prevent division-by-zero artifacts as R approaches 0.
- **Relativistic correctness:** the LW equations are exact for arbitrary velocities. Preserve the relativistic beaming factors `(1 - beta . n_hat)^3` faithfully. Do not silently drop relativistic terms for "simplicity."
- **Numerics:** prefer stable, inspectable stepping and predictable behavior over fragile micro-optimizations.
- **Visual approximations:** if a rendering heuristic is not a literal physical observable, say so directly in code comments.
- **Backreaction:** do not imply self-consistent radiation reaction or energy loss unless that physics is actually implemented and labeled as such.

## Architecture principles

### Physics decoupled from React

The simulation core under `src/physics/` must have zero React imports. It should be fully testable through a pure TypeScript interface — create a simulation, step it, query fields, assert results.

### History buffer owns the truth

The `ChargeHistory` buffer is the single source of truth for each charge's past kinematics. The retarded-time solver and LW field evaluator read from it. Nothing else should duplicate or shadow this data.

### Ref-based live coordination

Follow the pattern established in field-sandbox and wave-optics-sandbox:
- Refs hold live simulation state and history buffers.
- React state holds only UI-facing values (control panel settings, display toggles, selected mode).
- Animation-frame loops read from refs without triggering React renders.

### Layered rendering

Separate concerns into layers:
- **Physics layer** (`src/physics/`) — history buffer, retarded-time solver, LW field evaluator. No rendering or React concepts.
- **Rendering layer** (`src/rendering/`) — transforms field samples into draw primitives (arrow geometry, color mapping, contour data). Pure functions, no canvas or DOM access.
- **Component layer** (`src/components/`) — owns canvases, interaction hooks, control panel. Reads from physics and rendering layers.

### Canvas layers stay self-contained

Each canvas overlay (vector field, charge sprites, light cones, trails) should be a self-contained component that receives data and draws. Avoid leaking large internal state upward unless necessary.

### Minimize allocations in hot loops

The retarded-time solver and vector grid sampler run once per grid point per frame (1600+ calls at 40x40). Avoid allocating new objects or arrays (e.g., `new Vector2()`, `{ x, y }`, `[]`) inside these tight inner loops. Prefer pre-allocated scratch objects mutated in place, or pass target objects by reference. Immutable patterns are fine in the physics layer for per-charge-per-frame work, but not for per-pixel or per-grid-point work where allocation volume triggers GC stutter.

## Preferred engineering style for this repo

### Code quality principles

- **DRY:** extract shared logic into reusable helpers. If the same calculation or pattern appears in two places, factor it out. This applies especially to vector math, coordinate transforms, and field-sampling utilities.
- **Single responsibility:** each module, hook, or helper should do one thing well. Physics code should not contain rendering logic; rendering helpers should not contain interaction logic.
- **Composition over flags:** when behavior varies, prefer composing small focused units over adding boolean flags and conditionals to a large function.
- **Avoid premature abstraction:** extract when duplication is real and concrete, not hypothetical. Two instances of the same pattern is a signal; one instance is not yet.
- **No silent rewrites:** when modifying a file, change only the lines necessary to fulfill the request. Do not rewrite surrounding functions, strip existing comments, rename established variables, or reorganize imports unless that is explicitly part of the task. If a file needs broader cleanup, flag it and do that as a separate pass.

### Refactoring approach

- Prefer small, reviewable refactors over large rewrites.
- Work one file at a time when practical, especially for physics and rendering changes.
- First separate mixed concerns into named hooks, helpers, or render modules before adding lots of commentary.
- Prefer extracting coherent units such as:
  - retarded-time solver
  - LW field evaluator (velocity + acceleration terms)
  - history buffer management
  - vector grid sampling and rendering
  - interaction hooks (charge dragging, camera)
  - control-panel components
- Keep behavior stable unless the user explicitly asks for behavior changes.

### Import conventions

Use `@/` for cross-directory imports (e.g., `@/physics/types`, `@/rendering/worldSpace`).
Use `./` for same-directory imports (e.g., `./arrows`, `./chargeHistory`).
This matches the field-sandbox sibling convention and keeps import paths stable across refactors.

### Styling conventions

All UI components use Tailwind CSS v4. Do not add inline `CSSProperties` to UI files.
`src/index.css` is the single CSS entry point; `@import "tailwindcss"` must remain its first line.
Global design tokens (background, foreground) live in the `@theme inline` block in `index.css`.

### Naming conventions

- Prefer names that reflect the conceptual role of the code, not just the implementation detail.
- Name coordinate spaces and units explicitly where helpful: `world`, `screen`, `retarded`, `observation`, `source`, `bounds`, `zoom`, `offset`.
- Physics quantities should use conventional names: `beta` (v/c), `betaDot` (a/c), `nHat` (unit direction from retarded source to observation point), `R` (retarded distance), `tRet` (retarded time), `gamma` (Lorentz factor).
- In UI code, prefer names that match the user-visible concept:
  - `Velocity Field Layer`
  - `Radiation Field Layer`
  - `Light Cone Overlay`
  - `Retarded Position Marker`
- Avoid vague names like `data`, `helper`, `temp2`, or `misc`.
- Keep naming families consistent within a file once a pattern is established.

### Performance-sensitive UI work

- Treat pointer-driven interactions as performance-critical.
- Be cautious about pushing raw `pointermove` events straight into React state.
- Prefer:
  - refs for live interaction state
  - `requestAnimationFrame` batching for drag/pan updates
  - on-demand rendering for canvas layers where possible
- When optimizing, prefer temporary quality reductions only during active interaction (e.g., coarser grid sampling), with immediate full-quality restoration on release.
- Avoid degrading visuals more than necessary. Favor subtle reductions over obvious flicker or disappearing layers.

### Comments and docstrings

- Write comments for another developer who may be smart but new to the codebase or less familiar with classical electrodynamics.
- Aim for beginner-friendly but not overkill comments.
- Prefer short docstrings/comments that explain:
  - what a helper or subsystem is for
  - why a non-obvious numerical or rendering block exists
  - what ownership a ref or buffer has
  - what is approximate versus physically literal
- Add comments especially in:
  - retarded-time root-finding logic
  - LW field equation evaluation (label which term is the velocity field vs. the acceleration/radiation field)
  - history buffer management and pruning
  - relativistic correction factors
  - animation and render scheduling
  - world/screen transform code
- Do not narrate obvious syntax or restate a clear function name.
- Prefer stable explanations over change-log style comments like `NEW`, `FIXME` used as history, or implementation diary notes.
- When comments sit directly above function/type declarations, prefer coherent `/** ... */` doc comments instead of stacking `//` plus doc-comment blocks for the same idea.
- For JSX-heavy sections, comment larger structural blocks rather than individual tags.

### Documentation consistency

- If a file has been substantially refactored, do a short consistency pass so comments/docstrings across nearby files feel similar in tone and depth.
- Favor comments that explain intent, constraints, or mental model over comments that enumerate every branch.
- If user-facing behavior changes, update `README.md` in the same pass.
- If project scope or official supported modes change, keep `README.md`, `SPEC.md`, and this file aligned in the same pass.

## Verification habits

### Required checks after any TypeScript change

After touching any TypeScript file, run **in this order**:

```bash
npm run build        # REQUIRED — tsc -b + vite build (see note below)
npm test -- --run    # full test suite
npx eslint <touched-files>
```

**Critical: always use `npm run build`, never `tsc --noEmit` alone.**

This project uses TypeScript project references (`tsconfig.json` → `tsconfig.app.json`). The root `tsconfig.json` has `"files": []`, so `tsc --noEmit` without the `-b` flag type-checks **nothing** and always exits clean — it is a silent no-op. The flags that catch real errors (`noUnusedLocals`, `noUnusedParameters`, etc.) live in `tsconfig.app.json` and are only reached via `tsc -b`, which `npm run build` calls.

Similarly, **the Vite dev server (`npm run dev`) does not type-check**. Code that breaks the build can run fine on localhost. Never treat a passing dev server as evidence that the build is clean.

### Other verification habits

- Prefer targeted lint on touched files before full lint when repo-wide issues are possible.
- Treat automated tests as milestone-gating work, not as end-of-project cleanup.
- Add or extend tests in the same pass as each new milestone or subsystem.
- Prefer a layered test strategy:
  - pure physics/unit tests (history buffer interpolation, retarded-time convergence, LW field values against known analytical cases)
  - integration tests (stationary charge should recover Coulomb field; uniform motion should show relativistic beaming; sudden stop should produce a radiation shell)
  - focused UI behavior tests where practical
- For interaction or rendering changes, do a real manual browser check and report what was verified.
- If the app appears blank after a refactor, first suspect a compile-time error and check lint/build/dev-server output before deeper runtime debugging.

## Current architecture guidance

- The top-level sandbox component should be the composition layer (analogous to `ElectricFieldSandbox.tsx` in field-sandbox).
- The control panel should remain a floating UI surface rather than owning simulation behavior.
- The physics engine should live under `src/physics/` and provide at minimum these responsibilities (file organization is flexible):
  - **Types and interfaces** — Vector2, KinematicState, field result types, charge configuration
  - **History buffer** — per-charge time-stamped kinematic history with interpolated lookup and automatic pruning
  - **Retarded-time solver** — iterative root-finder that locates t_ret given an observation point and a charge history
  - **LW field evaluator** — computes E (velocity + acceleration terms) and B at an observation point using retarded-time state
- Rendering helpers should live under `src/rendering/`.
- Interaction hooks (charge dragging, camera pan/zoom, cursor readout) should be separate hook files.
- Coordinate transforms (world/screen) should be centralized, not scattered across components.

## Documentation guidance

- `SPEC.md` should define the official scope, canonical demo modes, and acceptance criteria for each milestone.
- `docs/architecture.md` should describe the ownership model, data flow, and layer boundaries.
- `docs/adr/` should record significant architectural decisions (e.g., LW over FDTD, history buffer design choices).
- `docs/future-directions.md` should track out-of-scope ideas to prevent scope creep while preserving good ideas.
- When scope changes, keep `README.md`, `SPEC.md`, and this file aligned in the same pass.

## Scope guidance

- **Path A (Canvas 2D):** the immediate development target. Get a single draggable charge generating a vector grid of fields including visible radiation pulses when the charge accelerates.
- **Path B (WebGL):** future upgrade. Do not prematurely optimize toward GPU rendering before the math and interaction model are validated on CPU.
- **Multiple charges:** plausible once single-charge fields are correct. Fields superpose linearly — each charge contributes independently via its own history buffer.
- **Self-consistent dynamics:** charges responding to each other's fields is architecturally possible but physically subtle (radiation reaction). Treat as a separate deliberate expansion, not a casual addition.
- **Reuse from field-sandbox:** the visual style, control-panel layout, camera model, and interaction hooks are the template. Reuse concepts and patterns, but keep this project self-contained — do not import code across repos.

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

When you open the app you will see a **start panel** with one card per demo mode. Click any card to begin — the simulation seeds immediately and the panel clears. You can return to this screen at any time with the **← Start screen** button in the Mode section of the control panel.

### The control panel

A floating panel in the upper-left corner gives you all controls:

| Section | What it does |
|---------|-------------|
| **Mode** | Switch between the demo modes (see below). Switching reseeds the simulation cleanly. **← Start screen** — return to the mode-picker panel and reset all settings to defaults (including c). |
| **Playback** | **Run / Pause** — toggle real-time playback. **Step →** — advance one frame at a time while paused. **Reset** — restart the current mode from t=0, keeping your field layer and overlay choices. **Stop now** — one-shot brake that returns every charge to a defined rest state over a fixed 0.2 s ramp (see per-mode braking models below). Available in every mode except Charge at rest; disables after firing, re-arms on Reset or mode change. |
| **Speed of light** | Drag the slider to change c (max 3.0). The lower bound is mode-dependent: 0.62 in Oscillating, Dipole, and the three Water modes; 0.72 in Moving charge and Hydrogen (the GPU history buffer must cover the causal horizon); 0.65 in Charge at rest. Lowering c slows all field propagation, making retarded-time effects dramatically visible. |
| **Field** | Toggle which vector layer you see: **Total E** (default), **Velocity E** (Coulomb-like term), **Accel E** (radiation term only), or **Poynting S** (instantaneous energy-flow arrows derived from E × B; aggressively compressed magnitude, mutually exclusive with the E layers). |
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

A charge moves at constant velocity. While moving, its field shows relativistic beaming — compressed forward, expanded backward. Click **Stop now** in the main control panel to brake the charge and launch a radiation shell. The shell expands outward at c. Inside: a pure Coulomb field from the stationary charge. Outside: the field still points toward where the charge would have been if it hadn't stopped.

**Braking model:** linear velocity ramp over 0.2 s, ending at the kinematic projection (`pos_T + v_T · 0.2 / 2`) with v = 0.

**To try:**
- Lower c before clicking Stop so the shell is easy to see at normal zoom.
- Pick **Accel B** on the **Magnetic heatmap** picker to see where the radiated magnetic field is concentrated. Flip to **Velocity B** to color the bound moving-charge field instead, and **Total B** to see both — including the post-stop void where the stopped charge sits inside the expanding shell.
- Toggle **Ghost charge** in the mini panel — a marker appears at the would-have-been position so the outside-of-shell field makes sense.
- Enable **Field lines** (while paused) and then **Ghost field lines** in the mini panel to compare the inside and outside field geometries side by side.
- Enable **Wavefront contours** to see the envelope contour marking the shell boundary.

### Oscillating charge

A charge oscillates sinusoidally along one axis, radiating continuously. The field shows the characteristic dipole pattern: strongest perpendicular to the motion, weaker along the axis. The wavefronts expand outward at c.

Click **Stop now** to brake the oscillator. The charge follows a Hermite cubic from its current `(pos, vel)` to `(0, 0)` over 0.2 s, sending a clean radiation shell outward as it settles at equilibrium.

**To try:**
- Pick **Accel B** on the **Magnetic heatmap** picker to map the radiated magnetic field intensity.
- Enable **Wavefront contours** to see zero-crossing lines that track the wave phase exactly.
- Lower c until you can see the wavefronts expanding in real time.
- Pause and enable **Field lines** to see the instantaneous field geometry.
- Click **Stop now** mid-oscillation to see the radiation shell from braking the harmonic motion.

### Dipole

Two opposite charges (one positive, one negative) oscillate in antiphase along a shared axis — a collinear electric dipole. Their individual Liénard-Wiechert fields are evaluated separately at every pixel and added by superposition. The result is the classic dipole radiation pattern: intensity peaks perpendicular to the axis and falls to zero along it.

This mode demonstrates that the simulator is not restricted to a single charge. Each charge has its own history buffer and retarded-time solve; the total field is the exact sum with no approximation.

**Stop now** brakes both charges in tandem with a Hermite cubic per charge, returning them to their separation-anchored equilibrium positions with v = 0.

**To try:**
- Pick **Accel B** on the **Magnetic heatmap** picker and pause — the lobed pattern is most vivid on a frozen frame.
- Zoom out to see several wavefront rings and the angular variation in brightness.
- Switch to **Accel E** to isolate just the radiation contribution from each charge.
- Compare with **Oscillating** (single charge): the dipole pattern looks similar but the field from the two charges partially cancels near the axis, sharpening the lobes.
- Click **Stop now** to watch the dipole-pattern radiation shell from braking both charges simultaneously.

### Hydrogen atom

A fixed positive charge sits at the center while a negative charge follows a prescribed circular orbit. This is a teaching model, not self-consistent orbital dynamics: the trajectory is scripted so the sandbox can focus on retarded fields, superposition, and radiation from a rotating dipole-like source.

**Stop now** here decelerates the orbital angular velocity linearly to zero over 0.2 s (constant angular deceleration `α = −ω₀ / T_BRAKE`). The orbiting charge stays on its circle, slowing down to rest at a terminal angle `θ_f = θ₀ + ω₀ · 0.2 / 2`. The central proton is untouched.

**To try:**
- Pick **Accel B** on the **Magnetic heatmap** picker and enable **Wavefront contours** to see the signed magnetic radiation pattern rotate outward.
- Pause and enable **Field lines** to compare the near-field geometry with the magnetic heatmap.
- Lower c to exaggerate the causal delay between the orbiting charge and the fields far from the atom.
- Click **Stop now** mid-orbit to see the radiation shell from braking a circular dipole source.

### Water molecule (three vibrational modes)

Three vibrational normal-mode analogues of an H₂O-like three-charge source: a negative oxygen and two positive hydrogens at the equilibrium geometry (bond length 0.6, H–O–H angle 105°, mass ratio 16:1).

- **Stretch** (ν₁, symmetric stretch) breathes both O–H bonds in phase along their bond directions.
- **Bend** (ν₂, scissoring) moves the atoms along the first-order bend normal mode, opening and closing the H–O–H angle while preserving bond lengths to first order in displacement amplitude.
- **Antisymmetric stretch** (ν₃) stretches one O–H bond while the other compresses, antiphase. Also called "asymmetric stretch" in introductory texts.

Stretch and bend modulate the dipole moment along the C₂ symmetry axis, so they radiate primarily along ±x (perpendicular to the C₂ axis). Antisymmetric stretch modulates the dipole along the H–H axis instead, so it radiates primarily along ±y — parallel to the C₂ axis, a 90° rotation from the stretch and bend radiation pattern. That orientation difference is a core IR-spectroscopy distinction: different normal modes of the same molecule have different radiation patterns as well as different frequencies.

This is a teaching model: all three atoms move as scripted normal-mode displacements with the mass-weighted center of mass held at the world origin by construction. It is not full molecular dynamics — the trajectories are prescribed sinusoids, not the result of solving equations of motion.

**Stop now** in any of the three modes returns every atom to its equilibrium position via a Hermite cubic in the shared scalar mode amplitude. Because every atom rides the same scalar, the mass-weighted center of mass stays at the origin throughout the brake — same property as the running normal mode itself.

**To try:**
- Open **Stretch**, pick **Accel B** on the **Magnetic heatmap** picker, enable **Wavefront contours**, and watch the dipole-pattern radiation peak along ±x (perpendicular to the C₂ axis).
- Switch to **Bend** at the same `c` and compare wavelengths — bend runs at half the stretch frequency, so its wave train has roughly twice the wavelength. This is the same intuition that lets IR spectroscopy distinguish vibrational modes by their characteristic frequencies.
- Switch to **Antisymmetric stretch** and notice the radiation pattern rotates 90°. Stretch and bend point dipoles along the C₂ axis; antisymmetric stretch points the dipole along the H–H axis. This is the spectroscopic distinction between ν₁ and ν₃ made visible.
- Enable **Velocity B** to see the bound magnetic field structure of the moving hydrogens.
- Click **Stop now** to brake the vibration and watch the radiation shell from the entire COM-conserving mode collapsing to equilibrium.

---

## Teaching overlays

All overlays are off by default. They stack freely — you can enable any combination.

| Overlay | Where | What it shows |
|---------|-------|---------------|
| **Field lines** | All modes, when paused | Instantaneous streamlines of the total electric field at the paused frame. Not material lines that move with the charge — they are a snapshot of the field at that moment. |
| **Magnetic heatmap** | Charge at rest, Moving charge, Oscillating, Dipole, Hydrogen, Water (all three modes) | A four-state picker (Off / Total B / Velocity B / Accel B) coloring the chosen Bz channel as a signed warm/cool heatmap. **Accel B** is the radiation magnetic field (Bz from the acceleration term — the pre-M11 "Radiation heatmap"). **Velocity B** is the bound moving-charge magnetic field. **Total B** sums both — useful for seeing the post-stop void in `Moving charge`. Contributions from all active charges are superposed before rendering. |
| **Wavefront contours** | Moving charge, Oscillating, Dipole, Hydrogen, Water (all three modes) | Contour lines tied to the radiation magnetic field (`bZAccel`) regardless of which heatmap channel is selected. In Oscillating, Dipole, Hydrogen, and the Water modes: zero-crossing lines tracking wave phase. In Moving charge: envelope threshold contour marking the shell boundary. |
| **Ghost charge** (mini panel) | Moving charge | A marker at the extrapolated would-have-been position after the stop. Shows why the field outside the shell still points toward a charge that is no longer there. |
| **Ghost field lines** (mini panel) | Moving charge, paused | Streamlines of the extrapolated constant-velocity field — shows what the field would look like if the charge had never stopped. |

---

## Getting started (developers)

```bash
npm install
npm run dev      # start dev server with hot reload at http://localhost:5173
npm test         # run physics unit tests (Vitest) — 175 tests across 11 suites
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
| `chargeRuntime.ts` | `ChargeRuntime` type: groups a `ChargeHistory` with its signed charge value; the unit of multi-charge arrays |
| `retardedTime.ts` | Retarded-time root-finder: fixed-point iteration (max 15 steps), graceful fallback |
| `lienardWiechert.ts` | Exact LW field evaluator: velocity term (1/R²) + acceleration term (1/R) + B field decomposition; `evaluateSuperposedLienardWiechertField` sums contributions from an arbitrary `ChargeRuntime[]` |
| `demoModes.ts` | Analytical kinematics for each demo mode; `sampleDemoChargeStates` returns per-charge specs for all modes; `sampleStoppedDemoChargeStates` is the post-Stop-now dispatch (linear v ramp for moving_charge, Hermite-cubic-to-equilibrium for harmonic modes, angular-velocity ramp for hydrogen); braking substep helper for radiation-shell sharpness |
| `stoppedFrame.ts` | Pure helper `recordStoppedFrame` that writes one stop-aware tick of substeps + current state into each charge's history; called from the simulation tick when a Stop-now trigger is active |
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
| `MovingChargeMiniPanel.tsx` | Draggable mini panel for moving-charge-specific overlay toggles: ghost-charge marker and ghost-field-lines streamlines. (Stop now itself lives in the main control panel and applies to every stoppable mode.) |
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

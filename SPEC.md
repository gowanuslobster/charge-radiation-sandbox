# Charge Radiation Sandbox V1 Spec

## Summary

Charge Radiation Sandbox is a sibling app to `field-sandbox` and `wave-optics-sandbox`, focused on teaching how moving and accelerating point charges produce electromagnetic fields and radiation. The engine uses the exact Lienard-Wiechert (LW) potentials — analytical solutions to Maxwell's equations for point charges in 3D vacuum — rather than a grid-based FDTD solver. This eliminates the dimensionality and statics problems that made FDTD unsuitable for point-charge pedagogy (see `IDEAS.md` for the full rationale and mathematical framework).

The implementation optimizes for pedagogical clarity over full physical generality. The student should come away understanding that fields propagate at finite speed, that a charge at rest produces a Coulomb field, that a moving charge produces a compressed/beamed field, and that only an accelerating charge radiates.

## Core Philosophy

- **Analytical over numerical.** The engine uses exact Lienard-Wiechert potentials evaluated from charge histories. There is no grid, no FDTD stepping, and no discretized Maxwell's equations. The field at any point is computed directly from the retarded-time state of each charge.
- **Pedagogical clarity over physical generality.** The speed of light is configurable so students can exaggerate causality delays. Visual layers separate velocity and acceleration fields so each concept is independently visible. Effects are made obvious before they are made accurate.
- **History-driven.** The per-charge history buffer is the single source of truth for the entire field computation. Every field value traces back to an interpolated kinematic state at a retarded time. There is no "current field" buffer — only charge histories and the LW equations.
- **Visual consistency.** This app is a member of the field-sandbox family. Interaction patterns, visual style, and control-panel layout should feel immediately familiar to a student who has used field-sandbox.

## Pedagogical Goals

After 10–15 minutes with this tool, a student should understand:

- **Retarded time:** the field at a point depends on where the charge *was*, not where it *is*. There is a causality delay equal to the distance divided by the speed of light.
- **Velocity field vs. acceleration field:** a charge that moves at constant velocity produces a distorted but non-radiating Coulomb-like field. Only acceleration produces radiation.
- **Radiation shell:** when a charge suddenly stops (or starts), a thin shell of radiation expands outward at `c`, separating the "old" field from the "new" field.
- **Relativistic beaming:** a fast-moving charge concentrates its field in the forward direction due to the `(1 - beta . n_hat)^3` denominator.
- **Superposition:** the total field from multiple charges is the vector sum of each charge's independent LW contribution.

## Success Criteria

The system is successful when:

- A student can open the app in Charge at Rest mode and see a familiar Coulomb field that matches their intuition from field-sandbox.
- A student can watch a charge stop and see a radiation shell expand outward, and can explain why the field outside the shell still "points to where the charge would have been."
- A student can drag a charge and directly observe that their acceleration of the charge produces radiation pulses.
- A student can toggle between velocity-field and acceleration-field layers and articulate the difference: one is Coulomb-like and always present, the other is radiation and only appears during acceleration.
- A student can lower the speed of light and watch the causality delay become dramatically visible.

## Current Official Baseline

The current official scope includes:

- an analytical LW field evaluator computing E (velocity + acceleration terms) and B at observation points via per-charge history buffers
- a retarded-time root-finder with iteration cap and graceful fallback
- a configurable speed of light (`c`) parameter with history buffer pruning that updates accordingly
- a Canvas 2D vector grid renderer (Path A) sampling the field on a grid and drawing arrows
- a set of canonical demo modes covering the key pedagogical scenarios
- a floating control panel with mode, field-layer, and basic playback controls plus a camera/interaction model consistent with `field-sandbox`
- automated test coverage for the physics core (history buffer, retarded-time solver, LW field values against analytical cases)

The current official scope does not include:

- WebGL fragment shader rendering (Path B)
- self-consistent charge dynamics (charges responding to each other's fields)
- radiation reaction or energy loss
- magnetic field visualization layers
- Poynting vector or energy flow visualization
- time-averaged field displays

## Canonical Demo Modes

### Charge at Rest

A single charge sits at rest. The field is a pure Coulomb field — radial, falling off as 1/R^2, with no radiation component. This is the baseline that should look identical to a single charge in `field-sandbox`. The student can drag the charge freely; radiation pulses appear whenever the charge accelerates.

**What the student learns:** the LW engine recovers electrostatics exactly. The velocity field is Coulomb's law. The acceleration field is zero. Dragging the charge makes this concrete — acceleration produces radiation.

### Uniform velocity

A single charge moves at constant velocity (configurable via a preset or slider). The field is compressed in the forward direction and expanded behind — relativistic beaming. There is still no radiation.

**What the student learns:** a moving charge does not radiate. The field is distorted but still falls off as 1/R^2. The beaming becomes dramatic as the speed approaches `c`.

### Sudden stop (Bremsstrahlung shell)

A charge moves at constant velocity and then abruptly stops at a marked position. A thin radiation shell expands outward from the stopping point at speed `c`. Inside the shell, the field is pure Coulomb (from the now-stationary charge). Outside the shell, the field still points to where the charge *would have been* if it had kept moving.

**What the student learns:** acceleration (including deceleration) is what produces radiation. The radiation shell is a direct, visible consequence of retarded time — the outside world hasn't "heard" yet that the charge stopped.

### Oscillating charge

A single charge oscillates sinusoidally along one axis. Continuous radiation waves propagate outward. The radiation pattern shows the characteristic dipole angular dependence — strongest perpendicular to the motion, zero along the axis of motion.

**What the student learns:** periodic acceleration produces periodic radiation (this is how antennas work). The radiation field falls off as 1/R, not 1/R^2, so it dominates at large distances.

### (Draggable behavior is part of Charge at Rest — see above.)

## Milestones

### M1: Physics core

Implement the history buffer, retarded-time solver, and LW field evaluator as pure TypeScript under `src/physics/` with no React dependencies.

**Acceptance criteria:**
- History buffer records states, prunes old entries, and interpolates correctly via binary search
- Retarded-time solver converges within the iteration cap for typical scenarios and returns a fallback for degenerate cases
- Charge at rest produces a Coulomb field: E magnitude proportional to 1/R^2, radially outward, acceleration field identically zero
- Uniformly moving charge produces a beamed velocity field with correct relativistic compression
- `c` is a configurable parameter, not a hardcoded constant
- Unit tests cover all of the above

### M2: Canvas 2D vector grid

Render the LW field on a sampled grid (e.g., 40x40) as arrows on an HTML Canvas, driven by a `requestAnimationFrame` loop reading from the physics core.

**Acceptance criteria:**
- Arrows render with the field-sandbox visual style (thin stems, arrowheads, magnitude-proportional length with clamping, color-coded)
- Dark background consistent with field-sandbox
- Charge at Rest looks correct (radial arrows, decaying outward)
- Uniformly moving charge shows visible beaming
- Frame rate stays usable (>30 FPS) for a single charge on a 40x40 grid

### M3: Radiation shell (sudden stop)

Implement a demo mode where a charge moves at constant velocity and stops. The expanding radiation shell should be clearly visible in the vector field.

**Acceptance criteria:**
- A thin shell of strong acceleration-field arrows expands outward at `c` from the stopping point
- Inside the shell: pure Coulomb field from the stationary charge
- Outside the shell: velocity field still pointing toward the extrapolated position
- The transition is visually crisp — a student can see the "before" and "after" regions clearly

### M4: Interactive dragging

Implement charge dragging with real-time history recording and field updates.

**Acceptance criteria:**
- Left-drag repositions the charge smoothly (RAF-batched, matching field-sandbox interaction style)
- The history buffer records the drag trajectory continuously
- Radiation pulses are visible during and after drag acceleration events
- The field updates in real time at usable frame rate

### M5: Expand controls and sudden-stop teaching overlays

Extend the existing camera/control-panel system with the remaining controls and overlays, especially the configurable speed of light, cursor readout, and richer sudden-stop interaction.

**Acceptance criteria:**
- Floating control panel includes: mode selector, play/pause/step/reset, `c` slider, field layer toggles (total field, velocity only, acceleration only)
- Cursor readout shows local field values at hover position (RAF-batched)
- All five canonical demo modes are functional and selectable
- `c` slider works: lowering `c` visibly exaggerates causality delays; history buffer adjusts pruning window; graceful clamping if history underruns
- In `sudden_stop` mode, the student can trigger the stop event interactively with a control (for example, a `Stop now` button) instead of relying only on a fixed scripted stopping point
- The `sudden_stop` mode keeps its finite braking ramp and shell-thickness physics; the interactive control changes only when the braking phase begins, not the braking duration or the radiation-shell model
- In `sudden_stop` mode, an optional ghost-charge overlay can be shown/hidden to illustrate the extrapolated would-have-been motion after the real charge stops
- The ghost overlay is pedagogical only: it is a visual aid for the outside-of-shell velocity field, not a second physical source that contributes to the actual LW field solve

### M6: Paused streamline overlays

Add optional field-line / streamline overlays for single-charge scenes when the simulation is paused or stepped to a fixed frame.

**Acceptance criteria:**
- When playback is paused, the student can toggle a streamline overlay that traces the instantaneous electric field of the current single-charge frame
- The streamline overlay is computed on demand for the paused frame and reused until the frame or relevant settings change; it is not continuously recomputed during normal playback
- In `sudden_stop` mode, the paused streamline overlay makes the shell kink / before-after structure visually legible
- In `sudden_stop` mode, when the ghost-charge overlay is enabled, the student can optionally show/hide a second streamline overlay for the ghost's extrapolated velocity-field pattern
- Streamline overlays are labeled and documented as an instantaneous visualization aid for a time-dependent field, not as material lines that physically move with the charge
- Performance remains acceptable because streamline tracing is restricted to paused / stepped frames and initially scoped to single-charge scenes

### M7: Multiple charges

Support two or more charges with independent history buffers. Fields superpose linearly.

**Acceptance criteria:**
- Each charge maintains its own history buffer
- The field at each grid point is the vector sum of each charge's LW contribution
- A two-charge demo (e.g., dipole with both charges oscillating) produces a recognizable dipole radiation pattern
- Performance remains usable for 2–4 charges on a 40x40 grid

## UI and Interaction Spec

### Viewport

- Full-window canvas with a dark (near-black) background
- Charge rendered as a filled circle with a sign indicator (+/−) at its current position
- Optional teaching markers/overlays may be shown to clarify causality, including:
  - a retarded-position marker
  - an extrapolated ghost-charge marker in `sudden_stop` mode showing the would-have-been continued motion outside the radiation shell

### Vector field layer

- Sampled on a regular grid (default 40x40, configurable)
- Arrow style matches field-sandbox: thin stems with arrowheads, length proportional to field magnitude with clamping, color-coded by magnitude
- Toggleable display modes: total E field, velocity field only, acceleration field only
- Color palette consistent with field-sandbox (orange/blue)

### Control panel

- Floating panel overlaid on the canvas, collapsible sections
- Does not own simulation behavior — pure UI surface
- Sections:
  - **Mode selector:** dropdown or button group for the canonical demo modes
  - **Playback:** play / pause / step / reset buttons
  - **Speed of light:** slider for `c` with visible numeric readout
  - **Field layers:** toggles for total field, velocity field, acceleration field
  - **Grid density:** selector (low / medium / high)
  - **Mode-specific controls:** when relevant, additional controls such as a manual `Stop now` trigger for `sudden_stop`
  - **Teaching overlays:** toggles for pedagogical overlays such as ghost-charge markers and paused-frame streamline displays

### Camera

- Scroll-to-zoom centered on cursor position
- Right-drag or middle-drag to pan
- World/screen transforms centralized in a single hook or module

### Interactions

- Left-drag to reposition charge (in Charge at Rest mode)
- Hover shows cursor readout with local field values
- All pointer-driven updates RAF-batched

## Rendering Strategy

### V1: Canvas 2D (Path A)

The v1 renderer iterates over a grid of observation points, solves the retarded time for each, evaluates the LW field, and draws arrows on a 2D Canvas. This is CPU-bound but straightforward to implement and debug.

### Future: WebGL (Path B)

After the physics and interaction model are validated, the renderer can be upgraded to a WebGL fragment shader that evaluates the LW equations per pixel. The charge history buffer would be uploaded as a data texture or uniform array. This path enables pixel-perfect continuous heatmaps at 60+ FPS. The UI architecture should not need to change — only the rendering layer swaps.

## Deferred Work and Future Directions

- **WebGL rendering (Path B):** plausible after the Canvas 2D path validates the physics and interaction model. Do not pursue prematurely.
- **Self-consistent dynamics:** charges responding to each other's fields via Lorentz force integration. Architecturally possible but physically subtle (radiation reaction, Abraham-Lorentz force). Treat as a separate deliberate expansion.
- **Magnetic field visualization:** B is computed for free from the LW equations, but adding a visual layer for it (arrows, heatmap) is deferred until the E-field visualization is stable.
- **Poynting vector / energy flow:** plausible later as a derived overlay. Requires both E and B, which are already computed.
- **Continuous live field-line tracing:** continuously recomputed field lines during normal playback remain deferred because time-dependent LW fields would require expensive re-tracing every frame. Paused-frame streamline overlays are covered by M6 instead.
- **Potential visualization:** scalar potential heatmap is less natural for the LW framework than for electrostatics. Deferred.
- **Sound or haptic feedback:** not in scope.

## Test Strategy

- Treat tests as milestone-gating work. Each milestone should add or update tests in the same pass.
- Favor a layered test pyramid: pure physics/unit tests first, then integration tests, then focused UI behavior tests.
- Keep the physics core testable through a pure TypeScript interface with no React dependencies.

### Key test cases

- **Coulomb recovery:** charge-at-rest field matches 1/R^2 Coulomb law at sampled points
- **Beaming:** uniformly moving charge field is stronger ahead than behind, with correct angular dependence
- **Radiation shell:** after sudden stop, field at points inside the shell matches the at-rest Coulomb field; field at points outside matches extrapolated moving-charge field; field at the shell boundary has a strong acceleration component
- **Retarded-time convergence:** solver converges within iteration cap for typical observation points; returns usable fallback for degenerate cases (R ≈ 0, edge of history buffer)
- **History buffer:** interpolation accuracy, pruning correctness, graceful clamping when lookup exceeds buffer range
- **Superposition:** field from two charges equals sum of individual fields at sampled points
- **`c` parameter:** changing `c` at runtime correctly affects retarded-time delays and history pruning window

### Regression discipline

- Prior milestone tests must pass after every new milestone.
- New demo modes must not introduce physics forks outside the source/charge configuration layer.

## Assumptions and Defaults

- Default `c = 1` in simulation units.
- Default grid density is 40x40.
- Default field display is total E (velocity + acceleration).
- Default demo mode on app load is Charge at Rest.
- All field computation uses the exact LW equations with full relativistic terms. No non-relativistic approximations unless explicitly added and labeled.
- Coordinate system: physics layer uses Cartesian (+X right, +Y up); rendering layer handles the Canvas flip (+Y down).
- No claim of self-consistent radiation reaction, charge-charge dynamics, or energy conservation is made in v1.

## Document Hierarchy

- `SPEC.md` (this file) defines the project intent, scope, milestones, and success criteria. It is authoritative for "what to build" and "when it's done."
- `IDEAS.md` is the physics and mathematics reference. It documents the LW framework, the FDTD failure analysis, and implementation skeletons. It is authoritative for "how the physics works."
- `AGENTS.md` governs implementation style, engineering conventions, and agent behavior. It is authoritative for "how to write the code."
- If there is a conflict between documents, SPEC.md defines intent.

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

- self-consistent charge dynamics (charges responding to each other's fields)
- radiation reaction or energy loss
- Poynting vector or energy flow visualization
- time-averaged field displays

M1–M7 and M9 are complete. The remaining milestone work is M8 and M10 as
defined in the Milestones section.

## Canonical Demo Modes

### Charge at Rest

A single charge sits at rest. The field is a pure Coulomb field — radial, falling off as 1/R^2, with no radiation component. The student can drag the charge freely; radiation pulses appear whenever the charge accelerates.

**What the student learns:** the LW engine recovers electrostatics exactly. The velocity field is Coulomb's law. The acceleration field is zero. Dragging the charge makes this concrete — acceleration produces radiation.

### Moving charge

A charge moves at constant velocity until the student clicks "Stop now," at which point it brakes to a halt over a short finite ramp. While moving, the field shows relativistic beaming — compressed in the forward direction, expanded behind. When the charge stops, a thin radiation shell expands outward from the stopping point at speed `c`. Inside the shell the field is pure Coulomb from the stationary charge; outside the shell the field still points toward where the charge would have been had it kept moving. An optional ghost-charge overlay marks that extrapolated position to make the causal boundary legible.

**What the student learns:** a uniformly moving charge does not radiate — only acceleration does. The radiation shell is a direct visible consequence of retarded time. The outside world hasn't "heard" yet that the charge stopped.

### Oscillating charge

A single charge oscillates sinusoidally along one axis. Continuous radiation waves propagate outward. The radiation pattern shows the characteristic dipole angular dependence — strongest perpendicular to the motion, zero along the axis of motion.

**What the student learns:** periodic acceleration produces periodic radiation (this is how antennas work). The radiation field falls off as 1/R, not 1/R^2, so it dominates at large distances.

## Milestones

### M1: Physics core — complete

Implement the history buffer, retarded-time solver, and LW field evaluator as pure TypeScript under `src/physics/` with no React dependencies.

**Acceptance criteria:**
- History buffer records states, prunes old entries, and interpolates correctly via binary search
- Retarded-time solver converges within the iteration cap for typical scenarios and returns a fallback for degenerate cases
- Charge at rest produces a Coulomb field: E magnitude proportional to 1/R^2, radially outward, acceleration field identically zero
- Uniformly moving charge produces a beamed velocity field with correct relativistic compression
- `c` is a configurable parameter, not a hardcoded constant
- Unit tests cover all of the above

### M2: Canvas 2D vector grid — complete

Render the LW field on a sampled grid (e.g., 40x40) as arrows on an HTML Canvas, driven by a `requestAnimationFrame` loop reading from the physics core.

**Acceptance criteria:**
- Arrows render with the field-sandbox visual style (thin stems, arrowheads, magnitude-proportional length with clamping, color-coded)
- Dark background consistent with field-sandbox
- Charge at Rest looks correct (radial arrows, decaying outward)
- Uniformly moving charge shows visible beaming
- Frame rate stays usable (>30 FPS) for a single charge on a 40x40 grid

### M3: Radiation shell (sudden stop) — complete

Implement a demo mode where a charge moves at constant velocity and stops. The expanding radiation shell should be clearly visible in the vector field.

**Acceptance criteria:**
- A thin shell of strong acceleration-field arrows expands outward at `c` from the stopping point
- Inside the shell: pure Coulomb field from the stationary charge
- Outside the shell: velocity field still pointing toward the extrapolated position
- The transition is visually crisp — a student can see the "before" and "after" regions clearly

### M4: Interactive dragging — complete

Implement charge dragging with real-time history recording and field updates.

**Acceptance criteria:**
- Left-drag repositions the charge smoothly (RAF-batched, matching field-sandbox interaction style)
- The history buffer records the drag trajectory continuously
- Radiation pulses are visible during and after drag acceleration events
- The field updates in real time at usable frame rate

### M5: Expand controls and sudden-stop teaching overlays — complete

Extend the existing camera/control-panel system with the remaining controls and overlays, especially the configurable speed of light, cursor readout, and richer sudden-stop interaction.

**Acceptance criteria:**
- Floating control panel includes: mode selector, play/pause/step/reset, `c` slider, field layer toggles (total field, velocity only, acceleration only)
- Cursor readout shows local field values at hover position (RAF-batched)
- All three canonical demo modes are functional and selectable
- `c` slider works: lowering `c` visibly exaggerates causality delays; history buffer adjusts pruning window; graceful clamping if history underruns
- In `moving_charge` mode, the student can trigger the stop event interactively via a draggable mini panel (`Stop now` button); the charge begins constant-velocity motion and the stop can be triggered at any point
- The `moving_charge` stop keeps its finite braking ramp and shell-thickness physics; the interactive control changes only when the braking phase begins, not the braking duration or the radiation-shell model
- In `moving_charge` mode, an optional ghost-charge overlay can be armed before or after the stop; if armed before the stop it appears immediately when the stop is triggered
- The ghost overlay is pedagogical only: it is a visual aid for the outside-of-shell velocity field, not a second physical source that contributes to the actual LW field solve

### M6: Sampled wavefront overlay — complete

Add an optional radiation visualization layer derived from the acceleration magnetic field,
available in `moving_charge` and `oscillating` modes only.

**Implementation steps (in order):**
1. Extend `LWFieldResult` with `bZVel` and `bZAccel` (identity: `bZ = bZVel + bZAccel`).
2. Build a coarse scalar sampler (~96×54 to 128×72, aspect-ratio aware) that evaluates `bZAccel` per cell with per-cell retarded-time warm-starting.
3. Build a heatmap layer from the sampled buffer with display-only dynamic-range compression.
4. Build a contour layer derived from the same sampled buffer.
5. Wire two independent teaching-overlay toggles: `Radiation heatmap` and `Wavefront contours`.

**Acceptance criteria:**
- `LWFieldResult` exposes `bZVel`, `bZAccel`, and `bZ`; the identity `bZ = bZVel + bZAccel` holds numerically; existing `bZ` callers are unaffected
- In `oscillating`, the signed heatmap shows alternating outward radiation fronts with legible wavelength spacing
- In `moving_charge`, the envelope heatmap shows a clear outward bremsstrahlung shell / pulse band
- Heatmap contrast remains readable across the visible domain without a saturated near-source blob; a display-only dynamic-range compression step (not a physics change) is applied
- Contours derive from the same sampled scalar buffer as the heatmap; heatmap and contours stay spatially aligned when both are enabled
- The scalar sampler uses temporal warm-starting for tRet solves when the sample lattice is unchanged; cache is invalidated on bounds change, `c` change, mode switch, or reseed
- Changing `c` during playback changes propagation spacing / shell motion consistently with the rest of the sandbox
- Both toggles default to off; turning the overlay off removes the extra sampling pass
- Performance remains usable (>25 FPS) for the two supported single-charge modes on the default grid
- Physics tests cover the magnetic decomposition and the decomposition identity

### M7: WebGL heatmap and oscillating contour — complete

Replace the CPU `WavefrontOverlayCanvas` with a WebGL fragment-shader renderer
that evaluates the LW field per-pixel. This milestone covers the radiation
heatmap for `moving_charge` and `oscillating` modes and the zero-crossing
contour for `oscillating`. The `draggable` mode heatmap and the `moving_charge`
envelope contour are deferred to M8. See `IDEAS-webGL.md` for the full design
rationale, data model, and solver specification.

**Implementation notes:**
- `WavefrontOverlayCanvas` is replaced by a new `WavefrontWebGLCanvas` component
  using `canvas.getContext('webgl2')` at the same z-index
- `ChargeHistory` is uploaded each frame as a 2D `RGBA32F` texture (`TEX_WIDTH=512 × TEX_HEIGHT=16`);
  timestamps are stored offset-relative to `t_current` to preserve float32 precision;
  the packing layout is 2 texels per state with 2D addressing `ivec2(texelIdx % TEX_WIDTH, texelIdx / TEX_WIDTH)`
  (see `IDEAS-webGL.md` §4); `MAX_TEXTURE_SIZE >= 512` is verified in the capability probe
- The fragment shader uses a bracketed Newton retarded-time solver (robust
  convergence within the valid history bracket); inner loop is a fixed-count
  binary search over the history texture
- The `useEffect` RAF loop must return a cleanup function that calls
  `cancelAnimationFrame` to prevent zombie loops under React Strict Mode
- The c-slider policy must prevent the causal horizon from exceeding the history
  buffer for visible pixels. M7 adopts Policy A (conservative global minimum)
  using the constraint formula in `IDEAS-webGL.md` §5:
  - `c_min(moving_charge) = 0.72`
  - `c_min(oscillating) = 0.62`
- If `WebGL2` or `RGBA32F` texture support is unavailable, the CPU
  `WavefrontOverlayCanvas` path activates as a lower-fidelity fallback with an
  inline student-friendly banner

**Acceptance criteria:**
- `WavefrontWebGLCanvas` renders the signed `bZAccel` heatmap in `oscillating`
  mode and the envelope `abs(bZAccel)` heatmap in `moving_charge` mode at full
  screen resolution
- The `oscillating` zero-crossing contour is shader-native and spatially aligned
  with the continuous heatmap field (no marching-squares offset artifact)
- No contour is drawn in `moving_charge` (deferred to M8)
- `draggable` mode has no heatmap overlay in M7; M6 did not add one, and a
  `draggable` shader path remains a future consideration (see `IDEAS-webGL.md` §3)
- GPU and CPU probe-point field values agree within
  `abs(gpu − cpu) ≤ 0.02 × referencePeak` (scene-scale reference peak, excluding
  the softening radius) at a probe set covering: one point inside the radiation
  shell, one near the shell peak, one in the far field, one near a zero crossing
  in `oscillating`, one off-axis, and one at extreme zoom-out distance; validated
  in both `oscillating` and `moving_charge` modes at `c = 1.0` and at a low-`c`
  value within the supported slider range
- No coarse-grid dropout islands in the `moving_charge` shell at far zoom
- `oscillating` heatmap shows continuous phase structure without staircase bands
- Heatmap and contour remain stable under zoom and pan
- Performance remains usable on supported WebGL2-capable hardware for the
  standard single-charge teaching scenarios in `moving_charge` and `oscillating`
- If WebGL2 / RGBA32F is unavailable, the CPU fallback activates with an inline
  banner and all other app functionality remains intact
- Existing tests (M1–M6) continue to pass

### M8: Shader-native envelope contour for `moving_charge`

Add the envelope threshold contour to the `moving_charge` heatmap. This
requires resolving the normalization-coupling problem: the contour threshold is
currently derived from the CPU grid's global field maximum, which is not
available in a single-pass GPU render. The design decision — two-pass GPU
reduction, lightweight CPU probe pass, or fixed physical threshold — is made as
part of this milestone's planning. See `IDEAS-webGL.md` §8 for the three options.

Optionally extend the GPU heatmap to `draggable` mode (envelope colormap) as
part of this milestone if the normalization design makes it straightforward.

**Acceptance criteria:**
- An envelope threshold contour is rendered in `moving_charge` mode, derived
  from the same GPU field as the heatmap (not from the coarse CPU sample grid)
- The contour is spatially aligned with the GPU heatmap under zoom and pan
- The normalization approach (two-pass GPU reduction, lightweight CPU probe pass,
  or fixed physical threshold) is chosen during M8 planning and consistently
  implemented; the chosen approach does not regress to the coarse CPU sample grid
  used in M6 (see `IDEAS-webGL.md` §8 for the three options)
- Visual quality is at least as good as the M6 CPU contour for the standard
  sudden-stop scenario
- Existing tests (M1–M7) continue to pass

### M9: Paused streamline overlays — complete

Add optional field-line / streamline overlays for single-charge scenes when the simulation is paused or stepped to a fixed frame.

**Acceptance criteria:**
- When playback is paused, the student can toggle a streamline overlay that traces the instantaneous electric field of the current single-charge frame
- The streamline overlay is computed on demand for the paused frame and reused until the frame or relevant settings change; it is not continuously recomputed during normal playback
- In `moving_charge` mode, the paused streamline overlay makes the shell kink / before-after structure visually legible
- In `moving_charge` mode, when the ghost-charge overlay is enabled, the student can optionally show/hide a second streamline overlay for the ghost's extrapolated velocity-field pattern
- Streamline overlays are labeled and documented as an instantaneous visualization aid for a time-dependent field, not as material lines that physically move with the charge
- Performance remains acceptable because streamline tracing is restricted to paused / stepped frames and initially scoped to single-charge scenes

### M10: Multiple charges

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
  - an extrapolated ghost-charge marker in `moving_charge` mode showing the would-have-been continued motion outside the radiation shell

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
  - **Mode-specific controls:** in `moving_charge` mode, a separate draggable mini panel provides a `Stop now` trigger and ghost-charge overlay toggle
  - **Teaching overlays:** toggles for pedagogical overlays — ghost-charge markers, radiation heatmap (M6), wavefront contours (M6), and paused-frame streamline displays (M9)

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

### Next: M8 envelope contour and GPU follow-on work

The WebGL renderer transition is now shipped for the M7 scope. The design is
specified in full in `IDEAS-webGL.md`. M7 delivered a fragment-shader heatmap
for `moving_charge` and `oscillating` modes plus a shader-native zero-crossing
contour for `oscillating`. The next rendering milestone is M8, which adds the
envelope contour for `moving_charge` and resolves the normalization coupling.

The CPU arrow renderer (Path A) is retained alongside the WebGL heatmap through
these milestones. The CPU physics implementation remains the validation oracle
for all GPU field values.

## Deferred Work and Future Directions

- **Remaining GPU rendering work:** M7 is shipped. M8 adds the
  `moving_charge` envelope contour and resolves its normalization coupling. See
  `IDEAS-webGL.md` for the full design.
- **Vector-grid density control:** an optional low / medium / high selector for
  the CPU arrow field may be added in a future pass if teaching needs or
  performance tuning justify it. This was removed from the v1 control-panel
  contract because it is not required for the current milestones, but it remains
  a valid future UX enhancement, especially for balancing visual clarity against
  CPU cost on weaker hardware or during interaction.
- **Full magnetic-field visualization:** a future expansion may add signed
  `Total B`, `Velocity B`, and `Accel B` heatmap modes, analogous to the
  existing `E` decomposition controls, while preserving the existing
  radiation-intensity overlay and keeping wavefront contours tied to `bZAccel`
  only. See `IDEAS-full-B-field-visualization.md`.
- **Self-consistent dynamics:** charges responding to each other's fields via Lorentz force integration. Architecturally possible but physically subtle (radiation reaction, Abraham-Lorentz force). Treat as a separate deliberate expansion.
- **Magnetic field visualization:** B is computed for free from the LW equations. The M6 radiation heatmap uses `bZAccel` as a measure of radiation intensity. A dedicated B-field vector arrow layer remains deferred.
- **Poynting vector / energy flow:** plausible later as a derived overlay. Requires both E and B, which are already computed.
- **Continuous live field-line tracing:** continuously recomputed field lines during normal playback remain deferred because time-dependent LW fields would require expensive re-tracing every frame. Paused-frame streamline overlays are covered by M9 instead.
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
- The app opens to a start panel. No demo mode is active until the student
  selects one.
- All field computation uses the exact LW equations with full relativistic terms. No non-relativistic approximations unless explicitly added and labeled.
- Coordinate system: physics layer uses Cartesian (+X right, +Y up); rendering layer handles the Canvas flip (+Y down).
- No claim of self-consistent radiation reaction, charge-charge dynamics, or energy conservation is made in v1.

## Document Hierarchy

- `SPEC.md` (this file) defines the project intent, scope, milestones, and success criteria. It is authoritative for "what to build" and "when it's done."
- `IDEAS.md` is the physics and mathematics reference. It documents the LW framework, the FDTD failure analysis, and implementation skeletons. It is authoritative for "how the physics works."
- `IDEAS-wavefronts.md` is the design rationale and extended specification for the M6 sampled wavefront overlay. It documents the `bZVel`/`bZAccel` decomposition, the warm-start tRet cache design, rendering architecture, and pedagogical positioning for that feature.
- `IDEAS-webGL.md` is the design specification for the WebGL renderer transition (M7–M8). It documents the data model, texture packing layout, solver design, c-slider policy, canvas architecture, fallback behavior, and acceptance criteria for the GPU rendering path.
- `IDEAS-full-B-field-visualization.md` records the future design direction for
  expanding the current radiation heatmap into full `B`-field visualization
  modes (`Total B`, `Velocity B`, `Accel B`) while keeping contours tied to
  `bZAccel`.
- `AGENTS.md` governs implementation style, engineering conventions, and agent behavior. It is authoritative for "how to write the code."
- If there is a conflict between documents, SPEC.md defines intent.

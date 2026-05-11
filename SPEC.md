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
- **Dipole radiation:** opposite charges with prescribed motion radiate through
  the superposition of their independent retarded fields.

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
- time-averaged or SI-calibrated energy-flux displays (the M12 Poynting layer
  is instantaneous and in sandbox units)
- time-averaged field displays

M1–M14 are complete (M13 was scoped, started, and mothballed; the
infrastructure pieces from that branch were ported forward in M14-A). M15 is
in progress (15-A landed COM-conserving normal-mode displacements for water;
15-B will add the antisymmetric stretch as a third water mode). Remaining
work is tracked as future directions rather than official v1 milestone scope.

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

### Dipole

Two opposite charges oscillate in antiphase along a shared axis, forming a
collinear electric dipole with a time-varying dipole moment. Each charge keeps
its own history buffer and contributes its own LW field; the displayed field is
the linear superposition of both contributions. This first multi-charge mode
uses the same multi-charge WebGL radiation heatmap path as the single-charge
modes, with CPU fallback where WebGL is unavailable.

**What the student learns:** radiation from a dipole is not a new field law — it
is the superposition of retarded fields from multiple charges. The pattern is
strongest perpendicular to the dipole axis and weak along the axis, connecting
the sandbox to antenna and molecular-vibration intuition.

### Hydrogen Atom

A fixed central positive charge and an orbiting negative charge form a scripted
hydrogen-like teaching model. The electron trajectory is prescribed circular
motion, not a self-consistent Coulomb orbit, so the mode stays within the same
analytic-history architecture as the other demos.

**What the student learns:** a rotating charge distribution radiates through the
same LW superposition machinery. This connects the sandbox to atomic and
molecular intuition while keeping the physics model explicit: the source motion
is imposed, and the emitted fields are computed from that history.

### Water — Symmetric Stretch

A three-charge H₂O-like source: a negative oxygen and two positive hydrogens
at COM-centered equilibrium geometry (bond length 0.6 sandbox units, H–O–H
angle 105°, mass ratio 16:1). Both O–H bonds breathe in phase along their
equilibrium bond directions, modulating the molecule's dipole moment along
the C₂ symmetry axis. All three atoms move; the mass-weighted center of mass
stays at the world origin by construction (M15-A). This is a scripted
normal-mode displacement, not full molecular dynamics. The radiated field
shows the characteristic dipole pattern peaked perpendicular to the C₂ axis.

**What the student learns:** vibrational motion with a time-varying dipole
moment radiates by the same LW machinery as the other modes. This is the IR
spectroscopy intuition — a vibration that modulates the dipole moment is
"IR-active" and emits radiation at its characteristic frequency.

### Water — Bend (Scissoring)

Same three-charge H₂O-like source. The atoms move along the first-order
bend normal mode — the H–O–H angle opens and closes while the O–H bond
lengths are preserved to first order in displacement amplitude. O takes
the mass-weighted COM-restoring counter-displacement along the C₂ axis. Bend runs at half the stretch
frequency (ω_bend = 2.0, ω_stretch = 4.0), mirroring the directional ratio of
real H₂O. The dipole-pattern orientation matches stretch (along the C₂ axis),
but the radiated wave train has roughly twice the wavelength at the same `c`.

**What the student learns:** different vibrational normal modes of the same
molecule have different characteristic frequencies, and that frequency
difference shows up directly in the wavelength of the radiated wave train.
This connects the sandbox to IR spectroscopy: distinct vibrational modes have
distinct IR signatures.

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
- The original three single-charge canonical demo modes are functional and selectable
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
- In `moving_charge`, the radiation heatmap shows the signed `bZAccel` pulse
  band with warm/cool colors indicating opposite out-of-plane magnetic-field
  directions
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
contour for `oscillating`. The `draggable` mode heatmap remains deferred. The
`moving_charge` envelope contour was restored in M8. See `IDEAS-webGL.md` for
the full design rationale, data model, and solver specification.

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
- `WavefrontWebGLCanvas` renders the signed `bZAccel` heatmap in both
  `oscillating` and `moving_charge` modes at full screen resolution; warm/cool
  colors indicate opposite signs of the out-of-plane magnetic radiation field
- The `oscillating` zero-crossing contour is shader-native and spatially aligned
  with the continuous heatmap field (no marching-squares offset artifact)
- The `moving_charge` contour is outside the M7 scope and is restored in M8
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

### M8: Shader-native envelope contour for `moving_charge` — complete

Restore the `moving_charge` wavefront contour on the WebGL path. The heatmap
itself remains signed `bZAccel`, matching `oscillating` mode. The contour is a
separate envelope annotation: it is drawn where `abs(bZAccel) / peak` crosses a
small threshold, so it marks the radiation shell boundary without changing the
signed heatmap semantics.

M8 chose the lightweight CPU-probe strategy from `IDEAS-webGL.md` §8: the
existing normalization probe estimates `peak` and uploads it as `u_peak`, while
the fragment shader draws the contour geometry per pixel from the same GPU
field used for the heatmap. The primary WebGL path uses
`CONTOUR_FRAC = 0.03`. The CPU fallback keeps its sampled contour extraction
path and uses its existing fallback contour level.

**Acceptance criteria:**
- An envelope threshold contour is rendered in `moving_charge` mode, derived
  from the same GPU field as the heatmap (not from the coarse CPU sample grid)
- The contour is spatially aligned with the GPU heatmap under zoom and pan
- The normalization approach is the lightweight CPU probe pass: CPU supplies only
  the scalar `u_peak`; contour geometry is shader-native and does not regress to
  the coarse M6 CPU marching-squares path on WebGL-capable hardware
- The `moving_charge` heatmap remains signed warm/cool `bZAccel`; only the
  contour threshold uses `abs(bZAccel)`
- Visual quality is at least as good as the M6 CPU contour for the standard
  sudden-stop scenario
- Existing tests continue to pass

### M9: Paused streamline overlays — complete

Add optional field-line / streamline overlays when the simulation is paused or stepped to a fixed frame.

**Acceptance criteria:**
- When playback is paused, the student can toggle a streamline overlay that traces the instantaneous electric field of the current frame
- The streamline overlay is computed on demand for the paused frame and reused until the frame or relevant settings change; it is not continuously recomputed during normal playback
- In `moving_charge` mode, the paused streamline overlay makes the shell kink / before-after structure visually legible
- In `moving_charge` mode, when the ghost-charge overlay is enabled, the student can optionally show/hide a second streamline overlay for the ghost's extrapolated velocity-field pattern
- Streamline overlays are labeled and documented as an instantaneous visualization aid for a time-dependent field, not as material lines that physically move with the charge
- Performance remains acceptable because streamline tracing is restricted to paused / stepped frames; multi-charge modes seed from each charge and trace the combined field

### M10: Multiple charges — complete

Generalize the runtime architecture from a single charge to an array of
independent charge runtimes, then ship the first multi-charge teaching mode as a
two-charge collinear vibrating dipole. A follow-on within the same architecture
adds a hydrogen-like atom with a fixed central positive charge and an orbiting
negative charge.

Implementation notes:
- Each runtime owns its own `ChargeHistory` and signed charge value
- `sampleDemoChargeStates()` returns the prescribed per-charge kinematic states
  for each demo mode
- `evaluateSuperposedLienardWiechertField()` sums the independent LW
  contributions from all active runtimes
- The CPU vector field, cursor readout, paused streamline overlay, and CPU
  wavefront overlay use the superposed field
- The dipole mode uses two opposite charges on the x-axis with antiphase
  sinusoidal motion; charges never cross
- The hydrogen mode uses a fixed positive charge and a prescribed circular
  negative-charge orbit
- The WebGL heatmap supports up to two independent charge histories, so dipole
  and hydrogen use the high-fidelity per-pixel radiation heatmap when WebGL is
  available

**Acceptance criteria:**
- Each charge maintains its own history buffer
- The field at each grid point is the vector sum of each charge's LW contribution
- The dipole demo produces a recognizable dipole radiation pattern
- The hydrogen demo shows a stable scripted circular orbit around a fixed
  positive center
- Streamlines and cursor readout use the combined field in multi-charge mode
- Radiation heatmap and wavefront contours are available in multi-charge modes
  through the WebGL path, with CPU fallback
- Superposition tests prove the multi-charge helper equals the manual sum of
  individual one-charge field evaluations
- Performance remains usable for the two-charge scripted modes on the default
  40x40 vector grid

### M11: Full magnetic-field visualization — complete

Generalize the pre-M11 radiation-only heatmap into a full magnetic-field
visualization. The overlay now exposes three signed `Bz` channels — `Total B`,
`Velocity B`, and `Accel B` — selectable through a labeled `Magnetic heatmap`
picker (Off / Total B / Velocity B / Accel B). The wavefront contour remains a
radiation annotation and continues to read `bZAccel` independently of the
heatmap channel.

Implementation notes:
- `sampleWavefront` returns a struct of three scratch buffers
  (`bZ`, `bZVel`, `bZAccel`) owned by the sampler state and reused across
  calls. One retarded-time solve per cell feeds all three, so the extra
  channels cost no additional solves.
- The WebGL shader's `computeBZComponents` derives all three components from
  the same retarded state. `main()` accumulates three per-channel sums across
  charges; a new `int` uniform `u_bzChannel` selects which sum colors the
  heatmap body, while the contour branch always reads the acceleration sum.
- Normalization is a mode-aware policy. Transient modes (`moving_charge`,
  `draggable`) use a per-channel EMA smoothed peak; periodic modes
  (`oscillating`, `dipole`, `hydrogen`) use a phase-sweep cache over one
  period `T = 2π/ω`, taking the max across 8 probe phases and reusing the
  cached peak until an invalidation condition fires (epoch, mode, `c`,
  charges, bounds, or channel).
- The CPU fallback mirrors the WebGL policy, selecting the heatmap buffer by
  channel and always feeding the contour extractor the `bZAccel` buffer.
- `draggable` mode is in scope: the magnetic picker is visible and active
  there; the wavefront-contour toggle remains hidden for `draggable` because
  there is no scripted wavefront structure to annotate.
- The pre-M11 `|Accel B|` envelope heatmap body is retired; the `Accel B`
  channel is its signed, pedagogically clearer successor. The `moving_charge`
  envelope contour (radiation shell annotation) is unchanged.

**Acceptance criteria:**
- Unit tests verify the cell-wise decomposition identity
  `bZ ≈ bZVel + bZAccel` and the uniformly-moving-charge invariant
  (`bZVel` nonzero off-axis, `bZAccel ≈ 0`)
- A uniformly moving charge displays a clean top-warm / bottom-cool
  right-hand-rule split under `Velocity B`, near-zero under `Accel B`
- After a `moving_charge` stop, `Total B` shows the post-stop void — a dead
  interior around the stopped charge surrounded by the expanding radiation
  shell
- Periodic modes render steady signed heatmaps across all three channels
  without frame-to-frame pulsing under the phase-sweep cache
- Switching channel, zooming/panning, changing `c`, or resetting forces a
  recompute and the normalization stabilizes within one frame
- Wavefront contours continue to trace `bZAccel` regardless of the selected
  heatmap channel
- WebGL and CPU-fallback paths produce matching structure across all three
  channels (coarser resolution expected on CPU)

### M12: Instantaneous Poynting-vector field-arrow mode — complete

Add a fourth mutually exclusive option to the vector-field selector,
`Poynting S`, derived from the already-computed `eTotal` and `bZ`:
`S ∝ (Ey·Bz, -Ex·Bz)`. The mode is rendered as a field-arrow layer (not a
heatmap) and remains compatible with the magnetic-heatmap channel and the
wavefront contour. The display is instantaneous in sandbox units — not a
calibrated SI energy-flux quantity and not a time-averaged radiated power.

Implementation notes:
- No new retarded-time solve is required; the cost is entirely in vector
  rendering and display tuning. The sampler returns `eTotal` and `bZ` as it
  already does for the electric channels and the magnetic heatmap.
- `fillArrowSpec` and `buildArrowSpec` gain a `style: 'electric' | 'poynting'`
  parameter that selects the magnitude-shaping curve, palette, and visibility
  threshold. Pre-M12 callers continue to default to `'electric'`.
- Magnitude shaping uses `shapedMag = Math.pow(rawMag, 0.25)` to compress the
  `1/r^4` near-field dynamic range so far-field radiation arrows remain
  legible alongside near-source arrows.
- The visibility threshold operates on the shaped magnitude, with a
  style-specific cutoff: `1e-4` raw for `'electric'` (unchanged) and `0.03`
  shaped (≈ `8.1e-7` raw) for `'poynting'`. The Poynting cutoff is
  intentionally more permissive than the electric raw cutoff because the
  compression curve exists to make small raw values visible.
- Near-charge fade pre-attenuates the input vector itself (smoothstep over a
  fixed world-space radius around the nearest charge) so the attenuation
  propagates through length, head length, line width, alpha, and glow rather
  than only through alpha. The fade radius is coupled to the visibility
  threshold: arrows whose attenuated magnitude drops below the threshold are
  rejected.
- Palette is a distinct olive → mid-gold → bright lime-gold ramp, separated
  from the electric orange → hot-yellow ramp.
- The Poynting layer is mutually exclusive with the electric vector layers
  (Total E / Velocity E / Accel E). It does not introduce a Poynting heatmap
  and does not introduce `Velocity S` / `Accel S` channels — the cross-term
  structure of the Poynting vector makes a naive component split
  pedagogically misleading.

**Acceptance criteria:**
- A `Poynting S` button appears in the Field section of the control panel
  with the gold palette, mutually exclusive with Total E / Velocity E /
  Accel E
- For a stationary charge, all Poynting arrows are suppressed (zero
  magnetic field → zero `S`), reinforcing that a static Coulomb field
  carries energy but does not transport it
- For a uniformly moving charge, the Poynting arrows show stable, nonzero
  bound-field energy-flow structure without numerical blowup or near-source
  NaN/garbage (the specific near-field geometry is observational, not a
  pass/fail oracle)
- After a sudden stop, the Poynting arrows are zero inside the radiation
  shell (static field) and point outward on the shell itself
- For oscillating, dipole, and hydrogen modes, far-field Poynting arrows
  read as outward energy flow
- The Poynting layer is compatible with the magnetic-heatmap channel and
  the wavefront contour: enabling either alongside `Poynting S` does not
  produce visual artifacts
- Unit tests cover the style parameter contract: pre-M12 default is
  `'electric'`, the threshold contract for the two styles, and a Poynting
  compression invariant (raw magnitudes 100× apart yield stem lengths
  within a small bounded ratio after compression)

### M13: Lines of charges — mothballed

A multi-charge expansion arranging discrete charges in a line, intended to
bridge microscopic point charges and macroscopic current/wire intuition. The
work split into three sub-milestones — Particle Beam (M13-A), Neutral Wire
approximation (M13-B), and Neutral-Wire stop-now (M13-C) — and lives on the
`feat/lines-of-charge` branch. The branch shipped capacity, perf, and tooling
infrastructure (MAX_CHARGES bump to 32, row-restricted history texture upload,
DPR/probe-grid perf cuts, paused-clean tick skip, opt-in dev perf logging,
build-vintage timestamp, per-mode default zoom) alongside the line-of-charge
modes themselves. Status: mothballed pending future activation. Pedagogical
framing and physics rationale live in `IDEAS-line-of-charges.md`; deferred
perf direction lives in `IDEAS-line-of-charge-perf-optimization.md`. The
infrastructure pieces (capacity, perf, timestamp) are ported forward
independently in M14-A.

### M14: Water molecule modes — complete

Two discrete demo modes — `water_stretch` and `water_bend` — that show
prescribed atomic motion of an H₂O-like three-charge source and the resulting
Liénard-Wiechert radiation pattern. Each mode is a periodic source with a
time-varying dipole moment along the C₂ axis, so both are 2D-IR-active. The
period distinction between the two modes connects the visualization to
IR-spectroscopy intuition that vibrational normal modes have characteristic
frequencies. M14 lands as two phases: M14-A ports infrastructure forward from
the mothballed M13 branch (WebGL N-charge capacity, Phase-1 perf tuning,
paused-clean tick skip, opt-in dev perf logging, build-vintage timestamp)
without introducing new demo modes; M14-B adds the two water modes built on
that foundation.

Implementation notes:
- Two discrete `DemoMode` values: `water_stretch` and `water_bend`. Sub-toggle
  rejected because every mode-keyed dispatch function (`sampleDemoChargeStates`,
  `maxHistorySpeed`, `minCForMode`, mode-specific UI visibility) keys on the
  `DemoMode` string; a sub-toggle would either thread a second parameter
  through all of them or create a parallel state slot with its own reset
  semantics.
- Three charges per mode in the locked order `[O, H₊x, H₋x]` (indices 0, 1, 2).
  The ordering must be preserved across all `t` because the WebGL history
  texture slot assignments depend on it.
- O is held fixed at the origin for both modes. This is **scripted teaching
  motion**, not normal-coordinate mass-weighted COM-conserving molecular
  dynamics. The fixed-O approximation keeps the kinematics closed-form and the
  dipole-radiation story unchanged; in real H₂O all three atoms move and the
  COM is conserved.
- Equilibrium geometry: bond length L₀ = 0.6 sandbox units; H–O–H angle
  θ₀ = 105°; H atoms at `(±sin(θ/2)·L₀, −cos(θ/2)·L₀)` (C₂ axis along y, H
  atoms hanging below O). Charge values: q_O = −0.8, q_H = +0.4 (net zero).
- Stretch (`water_stretch`): both O–H bond lengths breathe in phase with
  `L(t) = L₀ + A·sin(ω_s·t)`, A = 0.1, ω_s = 4.0. Peak H speed = A·ω_s = 0.4.
- Bend (`water_bend`): bond lengths fixed at L₀; H–O–H angle modulates as
  `θ(t) = θ₀ + Δθ·sin(ω_b·t)`, Δθ = 0.3 rad, ω_b = 2.0. Peak H speed
  = L₀·Δθ·ω_b/2 = 0.18. Real H₂O symmetric stretch frequency is about 2.3×
  the bend frequency; we use 2.0× to keep the IR-spectroscopy intuition
  while keeping bend visually responsive.
- Both modes share `CMIN_OSCILLATING = 0.62` because peak H speed ≤ 0.5 in
  both. `minCForMode` extends to include both.
- Both modes ride the existing multi-charge analytic branch in the simulation
  tick loop and `rebuildAnalyticHistoryAtCurrentTime` (the same branch used
  by `dipole` and `hydrogen`); no new branch needed.
- Both modes use Policy B (phase-sweep cache) normalization in
  `WavefrontWebGLCanvas`; period is `2π/ω` per mode (T_stretch ≈ 1.57 s,
  T_bend ≈ 3.14 s).
- ControlPanel mode picker introduces a small "Water molecule" subsection
  under the existing single-charge / atom buttons; StartPanel adds two
  matching mode cards. Both magnetic heatmap channels and wavefront contours
  are visible in water modes.

Acceptance criteria (M14-B):
- `water_stretch` shows three charges (O fixed at origin, two H atoms breathing
  radially in phase). Total E shows superposed Coulomb structure around the
  molecule; Accel B shows the time-varying dipole radiation pattern peaked
  along ±x; wavefront contours align with the heatmap and propagate outward
  at c.
- `water_bend` shows three charges with bond lengths visibly fixed and H–O–H
  angle visibly modulating. Same dipole orientation along the C₂ axis as
  stretch but a distinct period (T_bend ≈ 2 × T_stretch).
- The radiated wave train has visibly shorter wavelength in stretch than in
  bend at the same c, connecting to IR-spectroscopy intuition that
  vibrational modes have characteristic frequencies.
- All four magnetic heatmap channels (Off / Total B / Velocity B / Accel B)
  render without pulsing under scrub, pan, zoom, and channel switch in both
  modes.
- Both vector modes (E vectors, Poynting S) render correctly at N=3 and
  switch responsively.
- Wavefront contours visible and aligned with the heatmap in both modes.
- Cursor readout and field probe report sensible E and B at observation
  points outside the softening radius.
- Manual UI verification at desktop (≈1440×900), tablet (768 px), and mobile
  (375 px) viewports: StartPanel cards and ControlPanel layout do not
  introduce new horizontal overflow or text clipping; water content does not
  introduce new vertical overflow that wasn't already present pre-water.
- Unit tests cover: geometry safety preconditions
  (`WATER_HOH_ANGLE_RAD ± WATER_BEND_AMPLITUDE_RAD ∈ (0, π)`;
  `WATER_BOND_LENGTH > WATER_STRETCH_AMPLITUDE`); policy assertions
  (`maxHistorySpeed ≤ 0.5` for both modes); and per-mode behavioral tests
  (3 charge specs returned; net charge zero; O fixed across one period;
  mirror symmetry across the C₂ axis; c-min margin sweep; periodicity
  `state(t + 2π/ω) ≈ state(t)`; stable label ordering preserved across `t`).
- All M1–M12 and M14-A acceptance gates continue to pass.

### M15: COM-corrected water modes and antisymmetric stretch — in progress

M15 supersedes M14's runtime water-mode implementation while preserving the
M14 history above. It lands in two sub-phases:

- **M15-A — complete.** Replace the fixed-O scripted approximation of M14's
  `water_stretch` and `water_bend` with mass-weighted COM-conserving
  normal-mode displacements. All three atoms move; the molecule's center of
  mass stays at the world origin by construction. M14 frequencies and atom
  charge values are preserved. M15-A is a substantive physics correction to
  shipped behavior — the M14 milestone block above documents the original
  fixed-O implementation as shipped.
- **M15-B — planned.** Add a third water mode (`water_asym_stretch`) with the
  antisymmetric stretch normal-mode pattern, built on the M15-A equilibrium
  and displacement-vector foundation.

Implementation notes (M15-A):
- Atomic masses use the exact ratio `m_O : m_H = 16 : 1` (¹⁶O / ¹H
  approximation; the small isotopic correction is pedagogically irrelevant
  and would only make tests noisier).
- COM-centered equilibrium positions, below-O orientation (matching M14's
  textbook drawing):
    - `r_O_eq  = (0,             +L₀·cos(θ₀/2)/9)`
    - `r_H±_eq = (±L₀·sin(θ₀/2), -(8/9)·L₀·cos(θ₀/2))`
- Normal-mode displacement vectors satisfy
  `m_O·δ_O + m_H·(δ_H+ + δ_H-) = 0` by construction. Each atom moves as
  `r_atom(t) = r_atom_eq + A·sin(ω·t)·δ_atom`.
- Symmetric stretch basis: H atoms displace along their outward bond
  directions; O takes the COM-restoring counter-displacement along the C₂
  axis (`δ_O = (0, +cos(θ₀/2)/8)`).
- Bend basis: the first-order bend normal mode, derived by linearizing the
  COM-centered equilibrium positions with respect to the half-angle φ at
  fixed bond length L₀. Unnormalized:
  `δ_H± ∝ (±cos(θ₀/2), (8/9)·sin(θ₀/2))`,
  `δ_O  ∝ (0,          -sin(θ₀/2)/9)`.
  Two properties hold by construction: (i) mass-weighted COM conservation
  (`m_O·(-sinφ/9) + 2·m_H·(8/9)·sinφ = 0` with m_O = 16, m_H = 1); and
  (ii) first-order O–H bond-length preservation
  (`u · (δ_H± - δ_O) = 0` where u is the equilibrium bond unit vector).
  The basis is normalized by `N = √(cos²(θ₀/2) + (64/81)·sin²(θ₀/2))` so
  `|δ_H| = 1` and the `maxHistorySpeed = A·ω` contract is preserved
  (`WATER_BEND_NORM` exports this constant). Bond-length conservation is
  first-order only; the second-order deviation goes as `O(A²/L₀)` and stays
  in the pedagogical noise floor for small A.
- `WATER_BEND_AMPLITUDE` is a world-unit displacement amplitude paired with
  the normalized COM-linearized bend basis. The value `0.09` matches the M14
  peak H speed of `0.18` (= A·ω); the back-compat alias
  `WATER_BEND_AMPLITUDE_RAD` is derived from `2·A_bend/L₀ = 0.3` and remains
  numerically equal to the M14 angular amplitude.
- `maxHistorySpeed(mode) = A·ω · max_atom |δ_atom|`. H δ vectors are unit
  length and O δ norms are ≤ 1/8, so H binds and the entries reduce to
  `A·ω`. Both modes share `CMIN_OSCILLATING = 0.62` (unchanged from M14;
  no `minCForMode` change required because the empirical peak speed stays
  in the existing bucket).
- StartPanel water-card copy is updated to remove the "oxygen is held fixed"
  language and describe the COM-conserving normal-mode displacements (still
  scripted, still not full molecular dynamics).

Acceptance criteria (M15-A):
- All M14 acceptance gates continue to pass (label ordering, mirror symmetry,
  periodicity, c-min margin, magnetic heatmap channels, vector modes,
  wavefront contours).
- Mass-weighted COM-conservation test passes for position, velocity, and
  acceleration across the full period for both modes:
  `m_O·r_O + m_H·(r_H+ + r_H-) ≈ 0`.
- Equilibrium-position tests assert O sits at `+L₀·cos(θ/2)/9` above the
  origin and H atoms at `-(8/9)·L₀·cos(θ/2)` below.
- Empirical maxHistorySpeed test samples all three atoms at quarter-period
  offsets plus a dense interior grid and asserts observed peak speed ≤
  `maxHistorySpeed(mode)` and ≤ 0.5 for both modes.
- StartPanel cards no longer claim O is fixed.
- Visual check on dev server confirms the molecule sits with COM at world
  origin (small upward shift from the M14 O-at-origin frame is expected) and
  that the radiation pattern remains primarily oriented along ±x for both
  modes (perpendicular to the C₂ axis).

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
- Toggleable display modes are mutually exclusive: total E field, velocity field only, acceleration field only, or Poynting S (instantaneous energy-flow arrows derived from E × B)
- Color palette: the electric layers use the field-sandbox warm palette; the Poynting layer uses a distinct gold / green-gold palette to keep the two readable when switching between them

### Control panel

- Floating panel overlaid on the canvas, collapsible sections
- Does not own simulation behavior — pure UI surface
- Sections:
  - **Mode selector:** dropdown or button group for the canonical demo modes
  - **Playback:** play / pause / step / reset buttons
  - **Speed of light:** slider for `c` with visible numeric readout
  - **Field layers:** toggles for total field, velocity field, acceleration field
  - **Mode-specific controls:** in `moving_charge` mode, a separate draggable mini panel provides a `Stop now` trigger and ghost-charge overlay toggle
  - **Teaching overlays:** toggles for pedagogical overlays — ghost-charge markers, magnetic heatmap channel picker (M11; supersedes the M6 radiation heatmap toggle), wavefront contours (M6), and paused-frame streamline displays (M9)

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

### WebGL heatmap and GPU follow-on work

The WebGL renderer transition is shipped for the single-charge M7–M8 scope and
the two-charge M10 scope. The design is specified in full in `IDEAS-webGL.md`.
M7 delivered the fragment-shader radiation heatmap for `moving_charge` and
`oscillating` modes plus the shader-native zero-crossing contour for
`oscillating`. M8 restored the shader-native `moving_charge` envelope contour
while keeping the heatmap itself signed. M10 extends the history texture layout
and shader loop to two independent charge histories, allowing dipole and
hydrogen modes to use the same high-fidelity per-pixel radiation heatmap.

The CPU physics implementation remains the validation oracle for point probes of
all GPU field values.

## Deferred Work and Future Directions

- **WebGL capacity beyond 32 charges:** the WebGL heatmap currently supports
  up to `MAX_CHARGES = 32` independent charge histories with chargeCount-bounded
  per-frame uploads (see M14-A.2). This covers all current modes including the
  three-charge water modes. Source configurations beyond 32 active charges
  would need a further capacity bump and likely structural perf work — see
  `IDEAS-line-of-charge-perf-optimization.md` for the deferred perf playbook
  (half-resolution heatmap FBO, early-exit Newton, GPU-side normalization
  probe, per-charge culling) that becomes more relevant at higher charge
  counts.
- **WebGL efficiency tuning:** future work may add a manual heatmap quality
  control for lower-tier hardware, first by reducing internal WebGL render scale
  and then, if needed, by lowering CPU normalization-probe density/cadence. See
  `IDEAS-webGL-efficiency.md`.
- **Additional multi-charge demos:** water symmetric stretch and bend landed
  in M14 (see milestone block above). Asymmetric stretch (ν₃) and larger
  molecules remain deferred and build on the same N-charge infrastructure
  M14-A ported forward from the mothballed M13 branch.
- **Vector-grid density control:** an optional low / medium / high selector for
  the CPU arrow field may be added in a future pass if teaching needs or
  performance tuning justify it. This was removed from the v1 control-panel
  contract because it is not required for the current milestones, but it remains
  a valid future UX enhancement, especially for balancing visual clarity against
  CPU cost on weaker hardware or during interaction.
- **Full magnetic-field visualization:** a future expansion may add signed
  `Total B`, `Velocity B`, and `Accel B` heatmap modes, analogous to the
  existing `E` decomposition controls. The current radiation heatmap is already
  a signed `Accel B` / `bZAccel` view; wavefront contours remain tied to
  `bZAccel` as a radiation annotation. See
  `IDEAS-full-B-field-visualization.md`.
- **Self-consistent dynamics:** charges responding to each other's fields via Lorentz force integration. Architecturally possible but physically subtle (radiation reaction, Abraham-Lorentz force). Treat as a separate deliberate expansion.
- **Magnetic field visualization:** B is computed from the LW equations. The
  current radiation heatmap visualizes signed `bZAccel`; broader `B` controls
  and any dedicated magnetic-vector layer remain deferred.
- **Time-averaged Poynting / radiated power:** the M12 Poynting vector layer
  is instantaneous and uncalibrated. Time-averaged radiation intensity (a
  calibrated `<S>` map suitable for radiation-pattern teaching) remains
  deferred. See `IDEAS-poynting-vectors.md`.
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
- **Dipole kinematics:** the two dipole charges keep opposite signs, remain
  separated, and oscillate in antiphase along the shared axis
- **`c` parameter:** changing `c` at runtime correctly affects retarded-time delays and history pruning window

### Regression discipline

- Prior milestone tests must pass after every new milestone.
- New demo modes must not introduce physics forks outside the source/charge
  configuration layer; multi-charge modes should use the shared superposition
  helper rather than duplicating summation logic.

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
- `IDEAS-webGL.md` is the design specification for the single-charge WebGL
  renderer transition (M7–M8). It documents the data model, texture packing
  layout, solver design, c-slider policy, canvas architecture, fallback
  behavior, and acceptance criteria for the GPU rendering path.
- `IDEAS-webGL-efficiency.md` records future performance ideas for the WebGL
  heatmap path on lower-tier hardware, including render-scale controls and
  normalization-probe cost reduction.
- `IDEAS-full-B-field-visualization.md` records the future design direction for
  expanding the current radiation heatmap into full `B`-field visualization
  modes (`Total B`, `Velocity B`, `Accel B`) while keeping contours tied to
  `bZAccel`.
- `IDEAS-poynting-vectors.md` is the design rationale for the M12
  instantaneous Poynting-vector field-arrow mode. It documents the 2D
  `S ∝ (Ey·Bz, -Ex·Bz)` derivation, the `1/r^4` dynamic-range trap, the
  magnitude-compression and near-charge-fade strategy, and the rendering
  decisions adopted in M12.
- `AGENTS.md` governs implementation style, engineering conventions, and agent behavior. It is authoritative for "how to write the code."
- If there is a conflict between documents, SPEC.md defines intent.

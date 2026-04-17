# IDEAS — Full B-Field Visualization

## Context

The current heatmap overlay is deliberately scoped to the **radiative magnetic
field**: it visualizes `bZAccel`, not total `bZ`. That choice was correct for
the M6/M7 radiation-focused milestones because it cleanly isolates wavefronts,
bremsstrahlung shells, and dipole radiation without contamination from the bound
velocity-field magnetic component.

However, this creates a pedagogical gap. Many students already know the basic
statement that **moving charges generate a magnetic field**. In the current UI,
the heatmap only lights up where the **radiative** part of `B` is present, so it
is easy for a student to misread the overlay as "the magnetic field" rather than
"the radiative part of the magnetic field."

This document proposes a future expansion: make the magnetic field viewable in
the same decomposition style already used for `E`:

- **Total B**
- **Velocity B**
- **Acceleration B**

For this sandbox's 2D observation plane, those are scalar `z`-components:

- `bZ = bZVel + bZAccel`
- `bZVel` = bound / non-radiative magnetic component
- `bZAccel` = radiative magnetic component

The display mechanism should remain a signed heatmap using red/blue (warm/cool)
for sign, rather than vector arrows, because the field is out-of-plane.

## The Physics Shortcut: No New Retarded-Time Solve

This expansion does **not** require a new retarded-time root-finder or a second
Liénard-Wiechert solve per pixel. The same retarded state already used to
compute `E` is sufficient to derive all three magnetic quantities:

- `bZVel`
- `bZAccel`
- `bZ`

A fundamental property of the LW equations is that the magnetic field is always
perpendicular to both the electric field and the retarded normal vector
$\hat{n}$ (the unit vector from the retarded position to the observer). The
relationship is exactly:

$$\vec{B} = \frac{1}{c} (\hat{n} \times \vec{E})$$

This applies term-by-term. Once the retarded state and the electric-field
decomposition are available, `bZVel` and `bZAccel` are just 2D cross-products
with the normalized retarded vector, and `bZ = bZVel + bZAccel`.

That is a major physics simplification: the feature does **not** require a new
retarded-time solve. However, it is still not "free" in implementation terms.
It requires additional shader code, CPU fallback support, heatmap quantity
selection, and careful normalization / display design.

One important implementation note: the current WebGL path computes `bZAccel`
directly in the shader rather than first computing `eVel`, `eAccel`, and then
deriving `B`. So this feature does not need a new retarded-time solve, but it
does require a shader refactor or equivalent helper expansion so `Velocity B`
and `Total B` are available cleanly.

## The Visual Intuition: The Right-Hand Rule and The Void

Visualizing the B-field introduces distinct geometric structures that differ
radically from the E-field. This is a feature, not a bug, and connects directly
to intro-level physics:

1. **The "Right-Hand Rule" Split:** Because $\vec{B} = \hat{n} \times \vec{E}$,
   the cross product goes to zero directly along the axis of motion. A moving
   charge's B-field heatmap will be split in half by a black zero-crossing node
   along its trajectory. The top half will be warm (out of page), and the
   bottom half will be cool (into page). This gives the student a strong
   right-hand-rule intuition and a useful bridge to the familiar "moving charges
   produce magnetic circulation" idea from intro physics, without claiming that
   the point-charge LW field is literally the same geometry as the infinite-wire
   field.
2. **The Post-Stop Void:** When a moving charge suddenly stops, its E-field
   becomes a static Coulomb field. However, a stationary charge has *no*
   magnetic field. The `Total B` visualization of a sudden stop will show a
   vibrant, expanding radiation shell leaving a completely dead, black void in
   its wake, cleanly separating electrostatics from electrodynamics.

## Proposed user model

Do **not** introduce a top-level `Electric Field` vs `Magnetic Field` mode
switch. That would prevent one of the most useful teaching views in this app:
seeing the electric-field geometry and the magnetic-field structure at the same
time.

Instead, the visualization model should use **two independent channels** plus
the existing contour overlay:

### 1. Electric field channel

This is the existing arrow-based field view:

- `Off`
- `Total E`
- `Velocity E`
- `Accel E`

### 2. Magnetic heatmap channel

This is the out-of-plane scalar heatmap:

- `Off`
- `Total B`
- `Velocity B`
- `Accel B`

The magnetic channel remains a signed warm/cool heatmap because `B` is an
out-of-plane scalar (`bZ`) in this sandbox's 2D observation plane.

### 3. Wavefront contour overlay

This remains an independent overlay toggle and continues to be derived from
`bZAccel` only, exactly as it is now.

This preserves the current pedagogy:

- contours remain a radiation annotation, not a generic magnetic contour
- the contour still means "radiation front / radiative phase structure"
- the contour still aligns with the acceleration-field heatmap

### Resulting user-visible modes

This model naturally supports all three useful cases:

- **E-only:** electric channel on, magnetic channel off
- **B-only:** electric channel off, magnetic channel on
- **E + B:** both channels on simultaneously

That is the correct abstraction for this sandbox. It preserves comparison views
instead of forcing the student to choose between electric and magnetic pictures.

## Mode-by-mode expectations

### Charge at rest
- `Total B`, `Velocity B`, `Accel B` all equal 0.
- Pedagogical value: Visually proves that stationary charges produce no magnetic field.

### Moving charge
- `Velocity B` shows the bound magnetic field (the Right-Hand Rule top/bottom split) of the moving charge.
- `Accel B` shows the radiative shell / braking pulse.
- `Total B` shows the causal transition from the moving-charge B-field to the dead void after the stop.

### Oscillating charge
- `Accel B` remains the cleanest wave/radiation view.
- `Velocity B` shows the near-source bound magnetic structure.
- `Total B` shows both together; physically complete, but highly complex near the source.

### Draggable Mode
- Participates fully. Because draggable motion can include abrupt changes in
  velocity and acceleration, the signed B-field should respond with rapidly
  changing warm/cool magnetic structure near and around the charge. This could
  provide intuitive feedback for user input, but the exact visual behavior
  should be validated during implementation rather than promised in advance.

## Resolved Design Decisions & Normalization

1. **Signed vs. Envelope:** Full magnetic-field visualization should be signed
   everywhere. `Total B`, `Velocity B`, and `Accel B` should all use the same
   warm/cool sign convention, including in `moving_charge`. The sign is part of
   the magnetic physics and should not be hidden by default. Separately, the
   current envelope-style `|Accel B|` radiation heatmap should survive as a
   distinct special-purpose radiation-intensity view, especially in
   `moving_charge`, where it supports the absolute envelope contour introduced by
   M8. That envelope view is not the canonical magnetic-field representation; it
   is a separate radiation overlay.
2. **Normalization:** The magnetic quantities do not share a single useful
   display range. `Total B`, `Velocity B`, and `Accel B` have very different
   spatial dynamic ranges, especially near the charge where the bound-field
   contribution can dominate. In particular, `Total B` and `Velocity B` can
   show strong near-source $1/R^2$ blowout, while `Accel B` is the cleaner
   $1/R$ radiation quantity. Each magnetic heatmap mode therefore needs its own
   normalization / shaping path rather than inheriting a single scale from the
   current radiation-only overlay. The shader should apply a soft compressive
   curve (for example `tanh`) so the near-field region saturates gracefully
   without erasing the more distant radiative structure.

## Architectural implications

This is primarily a rendering and UI expansion, not a new physics milestone.
The physics layer already exposes:

- `bZVel`
- `bZAccel`
- `bZ`

The likely work areas are:

- **WebGL shader path**
  - expose `Velocity B`, `Accel B`, and `Total B` cleanly from the existing
    retarded state
  - add a uniform selecting which magnetic scalar the heatmap renders
  - preserve the existing contour path as an `Accel B`-only annotation
- **CPU fallback path**
  - extend the sampled wavefront path beyond `bZAccel`
  - decide whether CPU fallback supports all magnetic quantities immediately or
    only a subset in the first pass
- **Control panel**
  - add a magnetic heatmap quantity selector without overcrowding the current
    overlay section
  - preserve the ability to compare E arrows and B heatmap simultaneously
- **Naming and pedagogy**
  - relabel or clarify the current radiation heatmap as specifically an
    `Accel B` view once broader magnetic modes exist

## Open design questions

1. Should all three magnetic quantities be supported in the CPU fallback path
   immediately, or can the fallback remain radiation-focused in an initial
   version?
2. How should the control panel present the magnetic selector without making the
   overlays section too dense?

## Recommended milestone placement

This should be treated as a **post-M8 feature**, not folded into the current
rendering cleanup. M8 already has a clear responsibility: finish the
`moving_charge` envelope contour on the GPU path. Extracting mathematically accurate threshold contours from a shader is complex; that isolated problem must be solved before introducing cross-products, zero-nodes, and dual-color magnetic heatmaps.

## Summary

The current `bZAccel` heatmap is correct for teaching radiation, but it is not a
complete magnetic-field visualization. A future full-`B` expansion will let
students inspect `Total B`, `Velocity B`, and `Accel B` using the same
retarded state already computed for the LW field, providing a direct visual
bridge to the right-hand rule and Ampere's Law while keeping wavefront contours
tied strictly to `bZAccel`.

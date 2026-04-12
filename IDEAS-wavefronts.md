# Wavefront Idea 2: Sampled LW Radiation Heatmap and Contours

## Summary

This document proposes a future optional wavefront visualization system for Charge Radiation Sandbox built directly from the existing Lienard-Wiechert (LW) field solver.

This is not the earlier geometric-circle overlay idea. Instead, it is a true sampled field visualization derived from the actual LW solution at a coarse scalar grid. The goal is to provide a low-overhead but physically grounded way to make radiation fronts easier to see in the existing sandbox.

The feature is intentionally scoped to these two modes only:

- `moving_charge`
- `oscillating`

It is explicitly not proposed for `Charge at Rest` / draggable mode.

The feature is split into two stages:

1. Expose the full magnetic decomposition in the physics contract.
2. Build an optional sampled wavefront overlay on top of the acceleration-driven magnetic field.

## Why This Direction

The project already computes the exact LW electric field and derives the magnetic field from it. The current rendering path shows vector arrows, which are pedagogically strong for local field direction but less effective for making extended radiation fronts visually obvious.

A sampled scalar overlay can complement the arrows by making propagating radiation structure easier to see:

- in `oscillating` mode, alternating signed radiation fronts and wavelength spacing
- in `moving_charge` mode, the outward-moving bremsstrahlung shell / pulse band

This direction is also more future-proof than a geometric-circle overlay. Because it samples the real physical field, it can later extend naturally to multi-charge scenes where simple per-source circles would no longer represent the combined field correctly.

## Stage 1: Expose Magnetic Decomposition

### Motivation

The electric field is already exposed pedagogically as:

- `eVel`
- `eAccel`
- `eTotal`

The magnetic field is currently exposed only as:

- `bZ`

For both pedagogy and future rendering, the magnetic field should be exposed with the same decomposition.

Even if the wavefront overlay is never implemented, the magnetic split is useful on its own for teaching:

- which magnetic structure is tied to uniform motion
- which magnetic structure is tied specifically to radiation-producing acceleration
- how the total magnetic field combines these pieces

### Required Physics Contract Change

Extend `LWFieldResult` so it includes:

- `bZVel`
- `bZAccel`
- `bZ`

with the identity:

- `bZ = bZVel + bZAccel`

### Physics Definitions

These quantities should follow the same contract already used for total `B`:

- `bZVel = cross2D(nHat, eVel) / c`
- `bZAccel = cross2D(nHat, eAccel) / c`
- `bZ = cross2D(nHat, eTotal) / c`

This keeps the magnetic decomposition exactly parallel to the electric decomposition and avoids inventing any separate magnetic solver.

### Backward Compatibility

The existing `bZ` field should remain in the public result type so current callers do not break.

`bZ` should continue to mean the total out-of-plane magnetic field.

## Stage 2: Sampled Wavefront Overlay

### Core Idea

Add an optional scalar-field visualization derived from the acceleration magnetic field, sampled on a coarse grid each frame.

This is a radiation-focused overlay. It should visualize `bZAccel`, not total `bZ` and not potential.

The purpose is to make propagating radiation structure easier to read without replacing the existing vector-field arrows.

### Why Use `bZAccel`

For this overlay, `bZAccel` is the best target quantity because it isolates the radiative part of the field.

Using total `bZ` would mix together:

- non-radiative magnetic structure from uniform motion
- radiative magnetic structure from acceleration

That mixture would be less clean pedagogically and less effective visually.

Using `bZAccel` gives the overlay a clear conceptual meaning:

- it is a visualization of the magnetic radiation field
- it emphasizes the part of the electromagnetic field associated with changing motion
- it avoids near-field clutter dominating the picture

## Supported Modes in V1

### `oscillating`

Use a signed scalar derived from `bZAccel`.

Pedagogical goals:

- show alternating phase fronts
- make wavelength and propagation direction visually legible
- connect periodic source motion to outward-moving radiation structure

This mode should behave most similarly to the signed wavefront visualizations used in `wave-optics-sandbox`, while still being based on the LW solution rather than FDTD.

### `moving_charge`

Use an envelope or magnitude scalar derived from `|bZAccel|`.

Pedagogical goals:

- show the bremsstrahlung shell / pulse band clearly
- make the causal boundary easy to perceive
- emphasize where the acceleration-driven radiation lives spatially

This mode should not be framed as an infinitesimally thin perfect shell, because the current moving-charge mode uses a finite braking ramp and therefore produces a finite-thickness radiation region.

## Out of Scope in V1

- `Charge at Rest` / draggable mode
- a general multi-charge UI
- detector-like intensity accumulation
- time-averaged intensity
- energy-density or Poynting-vector interpretation
- replacing the arrow grid as the main field visualization
- exact per-pixel WebGL evaluation

## UI Model

The first version should use two separate toggles under teaching overlays:

- `Radiation heatmap`
- `Wavefront contours`

These toggles are independent.

Allowed states:

- both off
- heatmap only
- contours only
- both on

Both should default to off.

The representation should be selected automatically by mode:

- `oscillating`:
  - heatmap uses signed `bZAccel`
  - contours are extracted from the same signed sampled field
- `moving_charge`:
  - heatmap uses envelope / magnitude `|bZAccel|`
  - contours are extracted from the same envelope sampled field

There should be no manual Signed/Envelope selector in v1.

This keeps the UI simpler and ensures each mode defaults to the representation that best matches its teaching goal.

## Rendering Architecture

### General Approach

The overlay should be implemented as a separate sampled scalar render path layered with the existing vector field.

It should not change the underlying physics engine and should not introduce any new field model.

### Sampling Strategy

Use a coarse scalar grid distinct from the arrow grid.

Grid sizing is world-space driven: one sample per `TARGET_WORLD_CELL_FACTOR × c` world units in each axis (aspect-ratio aware), capped at `MAX_GRID_CELLS` total with both dimensions scaled down proportionally if the cap is exceeded. This keeps sampling fidelity proportional to the physical wavelength/shell-width regardless of zoom level, rather than using a fixed pixel count.

At each scalar sample point:

1. evaluate the LW field
2. read `bZAccel` (always signed)
3. store the signed value in the sampled scalar buffer

The sampler always stores the signed `bZAccel`. The mode-specific display transformation (abs() for envelope) is applied later in the rendering pipeline, after smoothing and upsampling, so the sign structure is preserved for the smoothing step.

### Heatmap Layer

The heatmap is built from a *render lattice* derived from the coarse sampled buffer through a scalar-space pipeline:

1. **Smooth** the signed coarse field with a 3×3 isotropic weighted stencil (center=4, cardinals=2, diagonals=1, normalized at boundaries). The isotropic kernel avoids the axis-aligned artifacts of a simple 5-point cardinal average.
2. **Bilinear upsample** the smoothed signed field to a finer render lattice using align-corners interpolation (`renderW = (gridW − 1) × scale + 1`). This upsampling occurs in scalar space, before color mapping, so that zero crossings interpolate toward zero rather than blending between warm and cool colors.
3. **Apply abs()** only after upsampling (envelope mode only). Keeping abs() after scalar-space interpolation preserves the sign-cancellation structure at phase boundaries.
4. **Color-map** the resulting display buffer.

Rendering expectations:

- stable contrast mapping
- visually consistent palette with the sandbox family
- low enough resolution to keep sampling affordable

For `oscillating`, the heatmap uses a signed color treatment (warm = positive lobe, cool = negative lobe) that makes alternating phase visible.

For `moving_charge`, the heatmap uses a single-polarity envelope treatment that emphasizes shell strength and extent.

The heatmap must not map raw `bZAccel` linearly to opacity or color. The acceleration field decays as `1/R`, so a linear mapping will produce a near-source region that dominates the display while distant wavefronts fade out too quickly to remain legible.

The rendering contract therefore requires display-only dynamic-range compression:

- the sampled scalar remains physically derived from `bZAccel`
- the heatmap renderer applies a contrast/exposure step based on field statistics such as peak and RMS
- the color transfer curve is non-linear, following the same general strategy already used in `wave-optics-sandbox` for signed and envelope heatmaps

This should be treated as a visualization rule, not a physics rewrite. The scalar field stays physically meaningful; only the display mapping is shaped for legibility.

Radius-weighted display heuristics such as multiplying by `R` may be explored later, but they are not the default v1 contract because they change the visual meaning of contour levels and are harder to interpret pedagogically.

### Contour Layer

Contours should be derived from the exact same upscaled display buffer used for the heatmap — post-smooth, post-upsample, post-abs.

Contours are a rendering transformation of the display field, not a separate physics solve.

This is important so that:

- heatmap and contours stay perfectly aligned (both operate on the same scalar values at the same render-lattice resolution)
- turning contours on adds minimal extra physics cost
- the two layers remain visually consistent

For `oscillating`, contours should represent signed phase structure.

For `moving_charge`, contours should represent envelope levels of the radiation shell / pulse band.

### Composition with Existing Arrows

The sampled overlay should remain optional and should not replace the arrow field by default.

The existing vector arrows remain the primary local-field visualization.

The new overlay is a complementary teaching layer that helps the student see extended radiation structure.

### Performance Expectations

This feature is intended to be low overhead relative to any full-resolution per-pixel LW render, but it is still more expensive than the current arrow-only path because it adds a second sampled field pass.

The design should therefore assume:

- single-charge only in v1
- coarse scalar resolution
- optional toggles with default off
- reuse of offscreen buffers where possible

To keep the CPU path viable, the scalar sampler should not restart the retarded-time solve from scratch at every grid point every frame. Instead, each scalar sample cell should cache its previous-frame `tRet` value and reuse that as the next frame's initial guess whenever the sample lattice is unchanged.

This warm-start cache should be treated as part of the intended design, not an optional micro-optimization. Because wavefront motion is smooth from frame to frame, the previous `tRet` at a fixed sample point is expected to be a much better seed than the current solver's generic newest-position bootstrap. That should cut the average iteration count significantly and reduce history-buffer binary-search churn.

The cache must be invalidated whenever any of the following change:

- camera bounds
- scalar-grid resolution
- display mode that changes the sample lattice or solve inputs
- speed of light `c`
- simulation reseed / mode switch
- any event that rebuilds the underlying history in a discontinuous way

If frame time is marginal, acceptable mitigations include:

- temporarily lowering scalar resolution during active pan
- reducing arrow density while the wavefront heatmap is enabled
- reusing sampled buffers while paused if no relevant inputs changed

The feature should not require Path B WebGL to be useful, but the architecture should remain compatible with a future WebGL implementation.

## Relationship to Future Multi-Charge Modes

This design should be described as future-compatible with multi-charge scenes, but not required to support them in v1.

That future compatibility is one of the main reasons to prefer sampled LW-derived fields over geometric circles.

Because LW fields superpose linearly, the same scalar-sampling architecture can later extend to:

- oscillating `+/-` dipoles
- bent three-charge molecular-style arrangements
- other multi-charge radiation demos

However, v1 should avoid promising those scenes until the multiple-charge milestone exists and the single-charge wavefront visualization is validated first.

## Pedagogical Positioning

This overlay should be documented carefully.

It is:

- an instantaneous visualization of a sampled physical radiation field
- derived from the exact LW solution already used by the sandbox
- a teaching aid layered on top of the vector field

It is not:

- a detector image
- a time-averaged intensity display
- a scalar electric potential map
- a replacement for the arrow field
- a claim about energy deposition or measured power

For `moving_charge`, it is especially important not to overstate the shell as an idealized infinitely thin boundary when the current mode intentionally models a finite braking interval.

## Acceptance Criteria

### Stage 1: Magnetic Decomposition

- `LWFieldResult` exposes `bZVel`, `bZAccel`, and `bZ`
- the decomposition identity holds numerically:
  - `bZ ≈ bZVel + bZAccel`
- stationary charge:
  - `bZVel = 0`
  - `bZAccel = 0`
  - `bZ = 0`
- uniform motion:
  - `bZAccel ≈ 0`
  - `bZVel` may be nonzero
  - `bZ ≈ bZVel`
- accelerating cases produce nonzero `bZAccel`

### Stage 2: Wavefront Overlay

- in `oscillating`, the sampled signed field shows alternating outward radiation fronts
- in `moving_charge`, the sampled envelope field shows a clear outward radiation shell / pulse band
- heatmap and contours remain spatially aligned because they derive from the same sampled scalar buffer
- changing `c` during playback changes the visual propagation spacing / shell motion consistently with the rest of the sandbox
- turning the overlay off removes the extra rendering pass
- performance remains usable for the supported single-charge modes
- heatmap contrast remains readable across the visible domain without a permanently saturated near-source blob
- the scalar sampler uses temporal warm-starting for retarded-time solves when the sample lattice is unchanged

## Suggested Testing Strategy

### Physics Tests

Add or extend pure physics tests to verify:

- magnetic decomposition formulas
- decomposition identity
- zero / near-zero acceleration cases
- expected nonzero acceleration magnetic term in oscillating and stopping scenarios

### Rendering Tests

Add focused rendering-helper tests for:

- signed scalar-to-color mapping
- envelope scalar-to-color mapping
- dynamic-range compression that preserves distant front visibility without turning the near-source region into a permanent flat saturation block
- contour extraction from a sampled scalar buffer
- stable alignment between heatmap and contour rendering inputs

### Solver / Sampling Tests

Add focused tests for the scalar-sampling pipeline to verify:

- previous-frame `tRet` seeds are reused when the sample lattice is unchanged
- cache invalidation occurs when bounds, scalar-grid dimensions, mode, `c`, or simulation epoch changes
- warm-started solves return results consistent with cold-start solves within the intended solver tolerance

### Manual Verification

Perform real browser checks for:

- oscillating mode with heatmap only
- oscillating mode with contours only
- oscillating mode with both on
- moving-charge mode with heatmap only
- moving-charge mode with contours only
- moving-charge mode with both on
- changing `c` while overlays are visible
- panning / zooming while overlays are enabled

## Recommended Implementation Order

1. Extend the LW result type with `bZVel` and `bZAccel`
2. Add physics tests for magnetic decomposition
3. Build a coarse scalar sampling helper for `bZAccel`, including per-cell `tRet` warm-start caching
4. Build heatmap rendering from that scalar buffer with display-only dynamic-range compression
5. Build contour extraction from the same scalar buffer
6. Add the two overlay toggles
7. Tune resolution, cache invalidation, and performance for the two supported modes
8. Document the feature as a pedagogical radiation overlay

## Assumptions and Defaults

- the feature remains CPU-based in its first implementation
- v1 supports only `moving_charge` and `oscillating`
- v1 excludes draggable mode
- the overlay derives from `bZAccel`
- heatmap and contours are separate toggles
- representation is auto-selected by mode
- both toggles default to off
- `bZ` remains in the public API for backward compatibility

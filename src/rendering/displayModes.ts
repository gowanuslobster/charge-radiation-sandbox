// displayModes.ts — user-facing display-selection types.
//
// These describe which display option the student has chosen in the control
// panel. They are *not* renderer-internal palette/curve enums (e.g. arrows.ts's
// 'electric' | 'poynting' style parameter); a control-panel selection of
// `Poynting S` happens to map onto the renderer's 'poynting' style today, but
// the two concepts are distinct and should not be collapsed.
//
// Lives in src/rendering/ (rather than src/components/) so the rendering layer
// can consume these vocabularies without component-layer files becoming a
// shared-types host. Per AGENTS.md:128, components read from physics and
// rendering; shared display vocabularies belong upstream of components.

/**
 * Vector-field-arrow layer selector for the main canvas.
 *
 *   'total'    — Total electric field (default; eVel + eAccel)
 *   'vel'      — Velocity (Coulomb-like) electric field component
 *   'accel'    — Acceleration (radiative) electric field component
 *   'poynting' — Instantaneous Poynting vector S ∝ (Ey·Bz, -Ex·Bz)
 *
 * The four options are mutually exclusive (one layer at a time). The renderer
 * uses its own internal 'electric' | 'poynting' style enum to pick palette and
 * magnitude-shaping curve; the mapping is one-line in VectorFieldCanvas.
 */
export type FieldLayer = 'total' | 'vel' | 'accel' | 'poynting';

/**
 * Magnetic-heatmap channel selector for the wavefront overlay.
 *
 *   'off'   — no magnetic heatmap (wavefront contour may still render independently)
 *   'total' — signed total Bz  = bZVel + bZAccel
 *   'vel'   — signed velocity (bound) Bz component
 *   'accel' — signed acceleration (radiative) Bz component; pedagogical successor
 *             of the pre-M11 absolute-value "Radiation heatmap"
 *
 * All three non-off channels render as signed warm/cool Bz; the wavefront
 * contour, when enabled, is always derived from bZAccel regardless of the
 * selected channel (it is a radiation annotation, not a magnetic isoline).
 */
export type MagneticHeatmapMode = 'off' | 'total' | 'vel' | 'accel';

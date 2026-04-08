// chargeMarker.ts — shared visual constants for the charge marker.
//
// Imported by both VectorFieldCanvas.tsx (drawing) and chargeHitTest.ts (hit testing)
// to avoid a circular dependency and keep the visual radius as the single source of truth.

/** Visual radius of the charge circle in CSS pixels. */
export const CHARGE_MARKER_RADIUS_PX = 8;

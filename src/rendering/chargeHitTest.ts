// chargeHitTest.ts — hit-test helper for the draggable charge marker.
//
// Pure function, no React, no DOM. Exported for direct unit testing.

import { CHARGE_MARKER_RADIUS_PX } from './chargeMarker';

/**
 * Hit radius for drag start.
 * Larger than the visual marker so the charge is easy to grab without pixel-perfect aim.
 */
export const CHARGE_HIT_RADIUS_PX = Math.max(CHARGE_MARKER_RADIUS_PX, 13);

/**
 * Returns true if the canvas-space point (cx, cy) is within CHARGE_HIT_RADIUS_PX
 * of the charge at canvas-space position (chargeCanvasX, chargeCanvasY).
 */
export function hitTestCharge(
  cx: number,
  cy: number,
  chargeCanvasX: number,
  chargeCanvasY: number,
): boolean {
  const dx = cx - chargeCanvasX;
  const dy = cy - chargeCanvasY;
  return dx * dx + dy * dy <= CHARGE_HIT_RADIUS_PX * CHARGE_HIT_RADIUS_PX;
}

// Coordinate-transform utilities for world↔canvas conversions.
//
// World space: +X right, +Y up (standard Cartesian).
// Canvas space: +X right, +Y down (HTML Canvas — Y axis is flipped).
//
// All world↔canvas conversions must flow through these functions exclusively.
// Never hardcode a Y-flip sign in drawing code; use the transform's negative `d` value.

import type { Vec2 } from '../physics/types';

export type WorldBounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Affine transform from world space → canvas pixels, with Y-axis flip.
 *
 *   screenX = a * worldX + e
 *   screenY = d * worldY + f   (d is always negative — encodes the Y flip)
 *
 * To transform a direction vector (not a point), use only the scale factors:
 *   screenDx = worldDx * a
 *   screenDy = worldDy * d   (Y flip is automatic — do NOT negate manually)
 */
export type WorldToScreenTransform = { a: number; d: number; e: number; f: number };

/**
 * Build the affine transform mapping world bounds onto a canvas of size w×h.
 *
 * Derivation:
 *   screenX = (w / spanX) * (worldX − minX)
 *   screenY = (h / spanY) * (maxY − worldY)   [top of world → top of canvas]
 *
 * Rearranged into ax+e / dy+f form:
 *   a = w / spanX,   e = −a * minX
 *   d = −h / spanY,  f = −d * maxY = (h / spanY) * maxY
 */
export function getWorldToScreenTransform(
  bounds: WorldBounds,
  w: number,
  h: number
): WorldToScreenTransform {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const a = w / spanX;
  const d = -h / spanY; // negative: Y-axis flip
  const e = -a * bounds.minX;
  const f = -d * bounds.maxY; // = (h / spanY) * maxY
  return { a, d, e, f };
}

/** Transform a single world-space point to canvas pixels. */
export function transformWorldPoint(pt: Vec2, t: WorldToScreenTransform): Vec2 {
  return { x: t.a * pt.x + t.e, y: t.d * pt.y + t.f };
}

/** Convert a world-space point to canvas pixels (convenience wrapper). */
export function worldToScreen(pt: Vec2, bounds: WorldBounds, w: number, h: number): Vec2 {
  return transformWorldPoint(pt, getWorldToScreenTransform(bounds, w, h));
}

/**
 * Convert a canvas-pixel point back to world space.
 *
 * Inverse of worldToScreen:
 *   worldX = (screenX − e) / a
 *   worldY = (screenY − f) / d
 */
export function screenToWorld(pt: Vec2, bounds: WorldBounds, w: number, h: number): Vec2 {
  const t = getWorldToScreenTransform(bounds, w, h);
  return { x: (pt.x - t.e) / t.a, y: (pt.y - t.f) / t.d };
}

/**
 * Compute the current view bounds from base bounds and camera state.
 *
 * Base bounds encode the default view (zoom=1, no offset): aspect-aware rectangle
 * centered at the world origin with halfHeight = 4.0 world units.
 *
 * Zoom shrinks the visible span (zoom > 1 → zoom in).
 * offsetX/Y shift the center in world space (positive offsetX → pan right).
 */
export function getViewBounds(
  baseBounds: WorldBounds,
  camera: { zoom: number; offsetX: number; offsetY: number }
): WorldBounds {
  const baseCenterX = (baseBounds.minX + baseBounds.maxX) / 2;
  const baseCenterY = (baseBounds.minY + baseBounds.maxY) / 2;
  const baseSpanX = baseBounds.maxX - baseBounds.minX;
  const baseSpanY = baseBounds.maxY - baseBounds.minY;

  const spanX = baseSpanX / camera.zoom;
  const spanY = baseSpanY / camera.zoom;
  const centerX = baseCenterX + camera.offsetX;
  const centerY = baseCenterY + camera.offsetY;

  return {
    minX: centerX - spanX / 2,
    maxX: centerX + spanX / 2,
    minY: centerY - spanY / 2,
    maxY: centerY + spanY / 2,
  };
}

/**
 * Diagonal length of a WorldBounds rectangle.
 * Retained for quick bounds-size estimates; the per-tick history horizon uses
 * maxCornerDist, which is more precise.
 */
export function boundsDiagonal(bounds: WorldBounds): number {
  const dx = bounds.maxX - bounds.minX;
  const dy = bounds.maxY - bounds.minY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Maximum distance from a point to any of the four corners of a bounds rectangle.
 *
 * Used for the per-tick history horizon:
 *   history.setMaxHistoryTime(maxCornerDist(sourcePos, viewBounds) / (c − speed))
 *
 * This is the exact maximum possible observer-to-source distance within the viewport,
 * correct regardless of where the source sits relative to the view (inside, outside,
 * or at a corner).
 */
export function maxCornerDist(pt: Vec2, bounds: WorldBounds): number {
  const { minX, maxX, minY, maxY } = bounds;
  let best = 0;
  for (const cx of [minX, maxX]) {
    for (const cy of [minY, maxY]) {
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > best) best = d;
    }
  }
  return best;
}

/**
 * Returns true if pt is inside bounds expanded by margin on all sides.
 * Used to gate the uniform-velocity auto-reseed check.
 */
export function isWithinBounds(pt: Vec2, bounds: WorldBounds, margin: number): boolean {
  return (
    pt.x >= bounds.minX - margin &&
    pt.x <= bounds.maxX + margin &&
    pt.y >= bounds.minY - margin &&
    pt.y <= bounds.maxY + margin
  );
}

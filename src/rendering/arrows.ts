// Arrow geometry and visual-weight utilities for the vector field renderer.
//
// Pure functions only — no canvas, no DOM, no React.
// The canvas draw loop (VectorFieldCanvas) consumes ArrowSpec objects produced here.
//
// Palette adapted from field-sandbox:
//   dim orange (84,33,17) → neon orange (255,122,63) → hot yellow (255,244,170)
// M2 uses the positive/orange palette only.
// A blue (negative charge) palette will gate on charge sign in M5+.

import type { Vec2 } from '@/physics/types';
import type { WorldToScreenTransform } from './worldSpace';

export type RGB = { r: number; g: number; b: number };

export type ArrowSpec = {
  x0: number; y0: number;       // stem start (canvas px)
  x1: number; y1: number;       // stem end / arrowhead anchor (canvas px)
  headX: number; headY: number; // arrowhead tip (same as x1,y1 for now — kept explicit)
  wingAngle: number;            // wing half-angle from backward direction (radians), ~0.62
  headLength: number;           // arrowhead leg length (px)
  lineWidth: number;
  alpha: number;
  color: RGB;
  glowBlur: number;
  glowAlpha: number;
};

// Tuning constants — matched to field-sandbox where possible.
// See AGENTS.md "Visual and interaction consistency" for the deviation policy.
const HINT_SCALE = 1.65;       // 1 − exp(−mag * HINT_SCALE) → saturation rate
const HOTNESS_EXPONENT = 4.8;  // sharpens the hot-white transition
const PALETTE_BREAK = 0.38;    // hint value where the gradient switches segments

/**
 * Map raw field magnitude to all visual weights.
 *
 *   hint             = 1 − exp(−magnitude * 1.65)   → [0, 1)
 *   lengthStrength   = hint
 *   intensityStrength = hint
 *   hotness          = pow(intensityStrength, 4.8)   → [0, 1)
 */
export function fieldToVisual(magnitude: number): {
  hint: number;
  hotness: number;
  lengthStrength: number;
  intensityStrength: number;
} {
  const hint = 1 - Math.exp(-magnitude * HINT_SCALE);
  const lengthStrength = hint;
  const intensityStrength = hint;
  const hotness = Math.pow(intensityStrength, HOTNESS_EXPONENT);
  return { hint, hotness, lengthStrength, intensityStrength };
}

/**
 * Two-segment orange → hot-yellow palette.
 *
 * Segment 1 (hint ∈ [0, 0.38]):  dim orange (84,33,17) → neon orange (255,122,63)
 * Segment 2 (hint > 0.38):        neon orange → hot yellow (255,244,170), driven by hotness
 */
export function arrowColor(hint: number, hotness: number): RGB {
  if (hint <= PALETTE_BREAK) {
    const t = hint / PALETTE_BREAK;
    return {
      r: Math.round(84 + t * (255 - 84)),
      g: Math.round(33 + t * (122 - 33)),
      b: Math.round(17 + t * (63 - 17)),
    };
  }
  const t = hotness;
  return {
    r: 255,
    g: Math.round(122 + t * (244 - 122)),
    b: Math.round(63 + t * (170 - 63)),
  };
}

/**
 * Fill a pre-allocated ArrowSpec in place.
 *
 * Returns true if the arrow was written, false if the field is too weak
 * (magnitude < 1e-4) or its canvas-space direction is degenerate.
 *
 * Mutates `out` and `out.color` directly — no heap allocation.
 * Use buildArrowSpec if you need a one-shot allocated result (e.g. in tests).
 *
 * The field direction is converted to canvas space using the transform scale factors
 * (not a full point transform): screenDx = worldDx * a, screenDy = worldDy * d.
 * Since d is negative, the Y-axis flip is automatic.
 *
 * maxLengthPx caps arrow length in screen pixels regardless of zoom.
 * Callers should pass (gridSpacingPx * 0.45) to prevent arrows exceeding their
 * grid cell at high zoom — a deviation from field-sandbox required by the
 * world-space (not screen-space) grid layout used here.
 */
export function fillArrowSpec(
  out: ArrowSpec,
  canvasX: number,
  canvasY: number,
  fieldVec: Vec2,
  transform: WorldToScreenTransform,
  maxLengthPx = Infinity
): boolean {
  const worldMag = Math.sqrt(fieldVec.x * fieldVec.x + fieldVec.y * fieldVec.y);
  if (worldMag < 1e-4) return false;

  const { hint, hotness, lengthStrength, intensityStrength } = fieldToVisual(worldMag);

  // Inline arrowColor: mutate out.color without allocating an RGB object.
  const color = out.color;
  if (hint <= PALETTE_BREAK) {
    const t = hint / PALETTE_BREAK;
    color.r = Math.round(84 + t * (255 - 84));
    color.g = Math.round(33 + t * (122 - 33));
    color.b = Math.round(17 + t * (63 - 17));
  } else {
    const t = hotness;
    color.r = 255;
    color.g = Math.round(122 + t * (244 - 122));
    color.b = Math.round(63 + t * (170 - 63));
  }

  // Convert field direction to canvas space (Y-flip via transform.d < 0).
  const sdx = fieldVec.x * transform.a;
  const sdy = fieldVec.y * transform.d;
  const screenDirMag = Math.sqrt(sdx * sdx + sdy * sdy);
  if (screenDirMag < 1e-10) return false;

  const ndx = sdx / screenDirMag;
  const ndy = sdy / screenDirMag;

  // Arrow length: field-sandbox power-curve formula, capped to maxLengthPx.
  // The cap prevents arrows overflowing their grid cell when zoomed in —
  // field-sandbox avoids this because it uses fixed screen-space grid spacing.
  const arrowLen = Math.min(
    2.8 + Math.pow(lengthStrength, 0.38) * 18 + hotness * 3.0,
    maxLengthPx
  );

  // Center the arrow on the sample point (field-sandbox style: 45% tail, 55% tip).
  // This makes the arrow read as "field at this location" rather than "starting from here."
  out.x0 = canvasX - ndx * arrowLen * 0.45;
  out.y0 = canvasY - ndy * arrowLen * 0.45;
  out.x1 = canvasX + ndx * arrowLen * 0.55;
  out.y1 = canvasY + ndy * arrowLen * 0.55;
  out.headX = out.x1;
  out.headY = out.y1;
  out.wingAngle = 0.62;
  // Head length: field-sandbox formula — grows with strength, not just raw arrowLen.
  out.headLength = Math.max(3, 2.4 + Math.pow(lengthStrength, 0.5) * 6.6 + hotness * 1.8);
  // Line width: field-sandbox formula — power curve + hotness boost.
  out.lineWidth = 0.5 + Math.pow(lengthStrength, 0.45) * 2.6 + hotness * 0.7;
  // Alpha: starts dim, steepens quickly — suppresses near-zero-field arrows.
  out.alpha = 0.12 + Math.pow(intensityStrength, 3.65) * 0.88;
  // Glow: field-sandbox formula, continuous from hint > 0.1 (no hard pop at 0.5).
  out.glowBlur = hint > 0.1 ? 1 + Math.pow(intensityStrength, 2.7) * 16 : 0;
  out.glowAlpha = hint > 0.1 ? 0.15 + Math.pow(intensityStrength, 2.0) * 0.3 : 0;

  return true;
}

/**
 * Build an ArrowSpec from a canvas-space origin and a world-space field vector.
 *
 * Allocates a new ArrowSpec on each call. Prefer fillArrowSpec with a pre-allocated
 * pool in hot loops (AGENTS.md §123).
 *
 * Returns null if |fieldVec| < 1e-4 (effectively zero field).
 */
export function buildArrowSpec(
  canvasX: number,
  canvasY: number,
  fieldVec: Vec2,
  transform: WorldToScreenTransform,
  maxLengthPx = Infinity
): ArrowSpec | null {
  const out: ArrowSpec = {
    x0: 0, y0: 0, x1: 0, y1: 0,
    headX: 0, headY: 0,
    wingAngle: 0, headLength: 0,
    lineWidth: 0, alpha: 0,
    color: { r: 0, g: 0, b: 0 },
    glowBlur: 0, glowAlpha: 0,
  };
  return fillArrowSpec(out, canvasX, canvasY, fieldVec, transform, maxLengthPx) ? out : null;
}

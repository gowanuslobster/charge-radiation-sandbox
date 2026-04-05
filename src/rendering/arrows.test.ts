import { describe, it, expect } from 'vitest';
import { fieldToVisual, arrowColor, buildArrowSpec } from './arrows';
import type { WorldToScreenTransform } from './worldSpace';

// Standard Y-flip transform: 10 pixels per world unit, canvas 200×160
const TRANSFORM: WorldToScreenTransform = { a: 10, d: -10, e: 100, f: 80 };

describe('fieldToVisual', () => {
  it('returns zero hint for zero magnitude', () => {
    const { hint } = fieldToVisual(0);
    expect(hint).toBeCloseTo(0);
  });

  it('hint is in [0, 1] for all inputs (approaches 1 at large magnitude)', () => {
    for (const mag of [0, 1e-5, 0.1, 1, 10, 100]) {
      const { hint } = fieldToVisual(mag);
      expect(hint).toBeGreaterThanOrEqual(0);
      expect(hint).toBeLessThanOrEqual(1);
    }
    // At small magnitudes it is strictly less than 1
    expect(fieldToVisual(1).hint).toBeLessThan(1);
  });

  it('all outputs are finite for edge-case magnitudes', () => {
    for (const mag of [0, 1e-5, 1, 100]) {
      const v = fieldToVisual(mag);
      expect(Number.isFinite(v.hint)).toBe(true);
      expect(Number.isFinite(v.hotness)).toBe(true);
      expect(Number.isFinite(v.lengthStrength)).toBe(true);
      expect(Number.isFinite(v.intensityStrength)).toBe(true);
    }
  });

  it('monotonically increasing: larger magnitude gives larger hint, hotness, lengthStrength', () => {
    const mags = [0.01, 0.1, 0.5, 1, 2, 5];
    for (let i = 1; i < mags.length; i++) {
      const prev = fieldToVisual(mags[i - 1]);
      const curr = fieldToVisual(mags[i]);
      expect(curr.hint).toBeGreaterThan(prev.hint);
      expect(curr.hotness).toBeGreaterThan(prev.hotness);
      expect(curr.lengthStrength).toBeGreaterThan(prev.lengthStrength);
    }
  });
});

describe('arrowColor', () => {
  it('returns integer RGB values in [0, 255]', () => {
    for (const [hint, hotness] of [[0, 0], [0.2, 0.01], [0.5, 0.3], [1, 1]] as const) {
      const { r, g, b } = arrowColor(hint, hotness);
      expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(255);
      expect(Number.isInteger(r)).toBe(true);
      expect(Number.isInteger(g)).toBe(true);
      expect(Number.isInteger(b)).toBe(true);
    }
  });

  it('hot orange (hint > 0.38) is brighter yellow than muted base', () => {
    const hot = arrowColor(0.9, 0.8);
    const cool = arrowColor(0.1, 0.0);
    expect(hot.g).toBeGreaterThan(cool.g); // more green = yellower
  });
});

describe('buildArrowSpec', () => {
  it('returns null for magnitude below 1e-4', () => {
    expect(buildArrowSpec(50, 50, { x: 0, y: 0 }, TRANSFORM)).toBeNull();
    expect(buildArrowSpec(50, 50, { x: 5e-5, y: 0 }, TRANSFORM)).toBeNull();
  });

  it('returns a spec with finite geometry for a typical +x field vector', () => {
    const spec = buildArrowSpec(50, 50, { x: 1, y: 0 }, TRANSFORM);
    expect(spec).not.toBeNull();
    const s = spec!;
    expect(Number.isFinite(s.x0)).toBe(true);
    expect(Number.isFinite(s.y0)).toBe(true);
    expect(Number.isFinite(s.x1)).toBe(true);
    expect(Number.isFinite(s.y1)).toBe(true);
    expect(Number.isFinite(s.headLength)).toBe(true);
    expect(Number.isFinite(s.lineWidth)).toBe(true);
    expect(Number.isFinite(s.alpha)).toBe(true);
    expect(s.alpha).toBeGreaterThan(0);
    expect(s.alpha).toBeLessThanOrEqual(1);
  });

  it('arrow tip is in the direction of the field vector (+x field → tip to the right)', () => {
    const spec = buildArrowSpec(50, 50, { x: 1, y: 0 }, TRANSFORM)!;
    // Field in canvas space: (1*a, 0*d) = (10, 0) → pointing right
    const dx = spec.x1 - spec.x0;
    const dy = spec.y1 - spec.y0;
    // Dot product with canvas-space field direction (10, 0)
    expect(dx * 10 + dy * 0).toBeGreaterThan(0);
  });

  it('arrow tip for +y world field goes up on canvas (Y-flip)', () => {
    const spec = buildArrowSpec(50, 50, { x: 0, y: 1 }, TRANSFORM)!;
    // Field in canvas space: (0*a, 1*d) = (0, -10) → pointing up on canvas (y decreases)
    const dx = spec.x1 - spec.x0;
    const dy = spec.y1 - spec.y0;
    // Dot product with canvas-space field direction (0, -10)
    expect(dx * 0 + dy * (-10)).toBeGreaterThan(0);
  });

  it('sample point lies between arrow tail and tip (centered layout)', () => {
    // field-sandbox style: 45% behind, 55% ahead of the sample point.
    const spec = buildArrowSpec(75, 30, { x: 2, y: 0 }, TRANSFORM)!;
    // For a +x field: tail is left of 75, tip is right of 75, y unchanged.
    expect(spec.x0).toBeLessThan(75);
    expect(spec.x1).toBeGreaterThan(75);
    expect(spec.y0).toBeCloseTo(30, 5);
    expect(spec.y1).toBeCloseTo(30, 5);
  });

  it('respects maxLengthPx cap: stem length does not exceed the cap', () => {
    const cap = 8;
    const spec = buildArrowSpec(50, 50, { x: 1, y: 0 }, TRANSFORM, cap)!;
    const stemLen = Math.sqrt((spec.x1 - spec.x0) ** 2 + (spec.y1 - spec.y0) ** 2);
    expect(stemLen).toBeLessThanOrEqual(cap + 1e-9);
  });

  it('maxLengthPx does not artificially shorten a short arrow', () => {
    // A very weak field produces a short arrow — a large cap should not change it.
    const specCapped = buildArrowSpec(50, 50, { x: 0.01, y: 0 }, TRANSFORM, 1000)!;
    const specUncapped = buildArrowSpec(50, 50, { x: 0.01, y: 0 }, TRANSFORM)!;
    const lenCapped = Math.sqrt((specCapped.x1 - specCapped.x0) ** 2 + (specCapped.y1 - specCapped.y0) ** 2);
    const lenUncapped = Math.sqrt((specUncapped.x1 - specUncapped.x0) ** 2 + (specUncapped.y1 - specUncapped.y0) ** 2);
    expect(lenCapped).toBeCloseTo(lenUncapped, 9);
  });
});

import { describe, it, expect } from 'vitest';
import { hitTestCharge, CHARGE_HIT_RADIUS_PX } from './chargeHitTest';

describe('hitTestCharge', () => {
  const cx = 100;
  const cy = 100;

  it('returns true for a point at the charge center', () => {
    expect(hitTestCharge(cx, cy, cx, cy)).toBe(true);
  });

  it('returns true for a point just inside the hit radius', () => {
    expect(hitTestCharge(cx + CHARGE_HIT_RADIUS_PX - 1, cy, cx, cy)).toBe(true);
  });

  it('returns true for a point exactly on the hit radius boundary', () => {
    // distance exactly equals radius: dx² + dy² = r²  →  should be inside (≤)
    expect(hitTestCharge(cx + CHARGE_HIT_RADIUS_PX, cy, cx, cy)).toBe(true);
  });

  it('returns false for a point just outside the hit radius', () => {
    expect(hitTestCharge(cx + CHARGE_HIT_RADIUS_PX + 1, cy, cx, cy)).toBe(false);
  });

  it('returns false for a point far from the charge', () => {
    expect(hitTestCharge(0, 0, cx, cy)).toBe(false);
  });

  it('works for a charge not at the canvas origin', () => {
    expect(hitTestCharge(200 + 5, 300 + 5, 200, 300)).toBe(true);
    expect(hitTestCharge(200 + CHARGE_HIT_RADIUS_PX + 1, 300, 200, 300)).toBe(false);
  });

  it('hit radius is at least 13 px', () => {
    expect(CHARGE_HIT_RADIUS_PX).toBeGreaterThanOrEqual(13);
  });
});

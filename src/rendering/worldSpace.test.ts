import { describe, it, expect } from 'vitest';
import {
  getWorldToScreenTransform,
  worldToScreen,
  screenToWorld,
  getViewBounds,
  boundsDiagonal,
  maxCornerDist,
  isWithinBounds,
} from './worldSpace';

const BOUNDS = { minX: -5, maxX: 5, minY: -4, maxY: 4 };
const W = 200;
const H = 160;

describe('worldToScreen / screenToWorld round-trip', () => {
  it('origin maps to canvas center', () => {
    const s = worldToScreen({ x: 0, y: 0 }, BOUNDS, W, H);
    expect(s.x).toBeCloseTo(100);
    expect(s.y).toBeCloseTo(80);
  });

  it('round-trips several world points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: -2 },
      { x: -5, y: 4 },
      { x: 5, y: -4 },
    ];
    for (const pt of pts) {
      const s = worldToScreen(pt, BOUNDS, W, H);
      const back = screenToWorld(s, BOUNDS, W, H);
      expect(back.x).toBeCloseTo(pt.x, 9);
      expect(back.y).toBeCloseTo(pt.y, 9);
    }
  });
});

describe('Y-axis flip', () => {
  it('positive worldY maps to canvas Y less than center (above center on screen)', () => {
    const center = worldToScreen({ x: 0, y: 0 }, BOUNDS, W, H);
    const above = worldToScreen({ x: 0, y: 2 }, BOUNDS, W, H);
    expect(above.y).toBeLessThan(center.y);
  });

  it('worldY=maxY maps to screenY=0 (top of canvas)', () => {
    const s = worldToScreen({ x: 0, y: 4 }, BOUNDS, W, H);
    expect(s.y).toBeCloseTo(0);
  });

  it('worldY=minY maps to screenY=H (bottom of canvas)', () => {
    const s = worldToScreen({ x: 0, y: -4 }, BOUNDS, W, H);
    expect(s.y).toBeCloseTo(H);
  });
});

describe('getViewBounds', () => {
  const base = { minX: -8, maxX: 8, minY: -4, maxY: 4 };

  it('zoom=1 offset=0 returns base bounds unchanged', () => {
    const vb = getViewBounds(base, { zoom: 1, offsetX: 0, offsetY: 0 });
    expect(vb.minX).toBeCloseTo(base.minX);
    expect(vb.maxX).toBeCloseTo(base.maxX);
    expect(vb.minY).toBeCloseTo(base.minY);
    expect(vb.maxY).toBeCloseTo(base.maxY);
  });

  it('zoom=2 halves the visible span', () => {
    const vb = getViewBounds(base, { zoom: 2, offsetX: 0, offsetY: 0 });
    expect(vb.maxX - vb.minX).toBeCloseTo((base.maxX - base.minX) / 2);
    expect(vb.maxY - vb.minY).toBeCloseTo((base.maxY - base.minY) / 2);
  });

  it('zoom=0.5 doubles the visible span', () => {
    const vb = getViewBounds(base, { zoom: 0.5, offsetX: 0, offsetY: 0 });
    expect(vb.maxX - vb.minX).toBeCloseTo((base.maxX - base.minX) * 2);
    expect(vb.maxY - vb.minY).toBeCloseTo((base.maxY - base.minY) * 2);
  });

  it('positive offsetX shifts view center right in world space', () => {
    const vb = getViewBounds(base, { zoom: 1, offsetX: 3, offsetY: 0 });
    const center = (vb.minX + vb.maxX) / 2;
    expect(center).toBeCloseTo(3);
  });

  it('positive offsetY shifts view center up in world space', () => {
    const vb = getViewBounds(base, { zoom: 1, offsetX: 0, offsetY: 2 });
    const center = (vb.minY + vb.maxY) / 2;
    expect(center).toBeCloseTo(2);
  });
});

describe('boundsDiagonal', () => {
  it('returns correct diagonal for a 3-4-5 rectangle', () => {
    const bounds = { minX: 0, maxX: 3, minY: 0, maxY: 4 };
    expect(boundsDiagonal(bounds)).toBeCloseTo(5);
  });

  it('returns correct diagonal for BOUNDS', () => {
    // spanX=10, spanY=8 → diagonal=sqrt(100+64)=sqrt(164)
    expect(boundsDiagonal(BOUNDS)).toBeCloseTo(Math.sqrt(164));
  });
});

describe('maxCornerDist', () => {
  it('returns correct max distance for an asymmetric case', () => {
    // Source near bottom-left corner of a [0,4]×[0,3] bounds
    const bounds = { minX: 0, maxX: 4, minY: 0, maxY: 3 };
    const pt = { x: 0.5, y: 0.5 };
    // Corner distances:
    //   (0,0): sqrt(0.25+0.25)=0.707
    //   (4,0): sqrt(12.25+0.25)=sqrt(12.5)=3.536
    //   (0,3): sqrt(0.25+6.25)=sqrt(6.5)=2.550
    //   (4,3): sqrt(12.25+6.25)=sqrt(18.5)=4.301 ← max
    expect(maxCornerDist(pt, bounds)).toBeCloseTo(Math.sqrt(18.5));
  });

  it('source at center returns half-diagonal', () => {
    const bounds = { minX: -4, maxX: 4, minY: -3, maxY: 3 };
    const pt = { x: 0, y: 0 };
    expect(maxCornerDist(pt, bounds)).toBeCloseTo(5); // 3-4-5
  });

  it('always returns the largest of the four corner distances', () => {
    const bounds = { minX: -3, maxX: 7, minY: -2, maxY: 5 };
    const pt = { x: 1, y: 2 };
    const corners = [
      Math.sqrt((1 + 3) ** 2 + (2 + 2) ** 2), // (-3,-2)
      Math.sqrt((1 - 7) ** 2 + (2 + 2) ** 2), // (7,-2)
      Math.sqrt((1 + 3) ** 2 + (2 - 5) ** 2), // (-3,5)
      Math.sqrt((1 - 7) ** 2 + (2 - 5) ** 2), // (7,5)
    ];
    expect(maxCornerDist(pt, bounds)).toBeCloseTo(Math.max(...corners));
  });
});

describe('isWithinBounds', () => {
  it('returns true for a point inside bounds', () => {
    expect(isWithinBounds({ x: 0, y: 0 }, BOUNDS, 0)).toBe(true);
  });

  it('returns false for a point outside bounds', () => {
    expect(isWithinBounds({ x: 6, y: 0 }, BOUNDS, 0)).toBe(false);
  });

  it('margin expands the bounds', () => {
    // Point just outside, within margin
    expect(isWithinBounds({ x: 5.5, y: 0 }, BOUNDS, 1.0)).toBe(true);
    expect(isWithinBounds({ x: 6.5, y: 0 }, BOUNDS, 1.0)).toBe(false);
  });

  it('returns true on the boundary itself', () => {
    expect(isWithinBounds({ x: 5, y: 4 }, BOUNDS, 0)).toBe(true);
    expect(isWithinBounds({ x: -5, y: -4 }, BOUNDS, 0)).toBe(true);
  });
});

describe('getWorldToScreenTransform direction properties', () => {
  it('transform.a is positive (X not flipped)', () => {
    const t = getWorldToScreenTransform(BOUNDS, W, H);
    expect(t.a).toBeGreaterThan(0);
  });

  it('transform.d is negative (Y is flipped)', () => {
    const t = getWorldToScreenTransform(BOUNDS, W, H);
    expect(t.d).toBeLessThan(0);
  });
});

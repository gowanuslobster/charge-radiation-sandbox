import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildHeatmapImageData,
  extractContourSegments,
  getDefaultContourLevels,
  createRenderWorkspace,
} from './wavefrontRender';

// ─── Node polyfills for browser Canvas APIs ──────────────────────────────────

beforeAll(() => {
  // ImageData: minimal polyfill — Uint8ClampedArray-backed, width/height, data.
  if (typeof globalThis.ImageData === 'undefined') {
    class ImageDataPolyfill {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width  = w;
        this.height = h;
        this.data   = new Uint8ClampedArray(w * h * 4);
      }
    }
    (globalThis as Record<string, unknown>).ImageData = ImageDataPolyfill;
  }
});

// ─── buildHeatmapImageData ────────────────────────────────────────────────────

describe('buildHeatmapImageData', () => {
  it('all-zero field → all pixels fully transparent (alpha = 0)', () => {
    const w = createRenderWorkspace();
    const scalars = new Float32Array(6 * 4); // all zeros
    const img = buildHeatmapImageData(scalars, 6, 4, 'signed', w);
    for (let k = 0; k < 6 * 4; k++) {
      expect(img.data[k * 4 + 3]).toBe(0); // alpha channel
    }
  });

  it('uniform non-zero field → no pixel has alpha = 0', () => {
    const w = createRenderWorkspace();
    const scalars = new Float32Array(6 * 4).fill(1.0);
    const img = buildHeatmapImageData(scalars, 6, 4, 'signed', w);
    for (let k = 0; k < 6 * 4; k++) {
      expect(img.data[k * 4 + 3]).toBeGreaterThan(0);
    }
  });

  it('signed mode: known positive value → warm hue (R > B)', () => {
    const w = createRenderWorkspace();
    const scalars = new Float32Array(1).fill(1.0);
    const img = buildHeatmapImageData(scalars, 1, 1, 'signed', w);
    const r = img.data[0];
    const b = img.data[2];
    expect(r).toBeGreaterThan(b); // warm amber: R=255, B=30
  });

  it('signed mode: known negative value → cool hue (B > R)', () => {
    const w = createRenderWorkspace();
    const scalars = new Float32Array(1).fill(-1.0);
    const img = buildHeatmapImageData(scalars, 1, 1, 'signed', w);
    const r = img.data[0];
    const b = img.data[2];
    expect(b).toBeGreaterThan(r); // cool blue-violet: R=80, B=255
  });

  it('envelope mode: all values use warm hue (R > B) for any nonzero value', () => {
    const w = createRenderWorkspace();
    // Envelope mode: caller passes abs(bZAccel), so all values are ≥ 0.
    const scalars = new Float32Array([0.5, 0.1, 0.9, 0.3]);
    const img = buildHeatmapImageData(scalars, 2, 2, 'envelope', w);
    for (let k = 0; k < 4; k++) {
      const base = k * 4;
      if (img.data[base + 3] > 0) {
        expect(img.data[base]).toBeGreaterThan(img.data[base + 2]); // R > B
      }
    }
  });

  it('ImageData dimensions match gridW × gridH', () => {
    const w = createRenderWorkspace();
    const scalars = new Float32Array(5 * 7).fill(1.0);
    const img = buildHeatmapImageData(scalars, 5, 7, 'signed', w);
    expect(img.width).toBe(5);
    expect(img.height).toBe(7);
    expect(img.data.length).toBe(5 * 7 * 4);
  });

  it('reuses same ImageData object across calls when dimensions unchanged', () => {
    const w = createRenderWorkspace();
    const scalars = new Float32Array(4 * 4).fill(1.0);
    const img1 = buildHeatmapImageData(scalars, 4, 4, 'signed', w);
    const img2 = buildHeatmapImageData(scalars, 4, 4, 'signed', w);
    expect(img1).toBe(img2); // same object reference
  });

  it('allocates a new ImageData when dimensions change', () => {
    const w = createRenderWorkspace();
    const s1 = new Float32Array(4 * 4).fill(1.0);
    const s2 = new Float32Array(6 * 6).fill(1.0);
    const img1 = buildHeatmapImageData(s1, 4, 4, 'signed', w);
    const img2 = buildHeatmapImageData(s2, 6, 6, 'signed', w);
    expect(img1).not.toBe(img2);
    expect(img2.width).toBe(6);
    expect(img2.height).toBe(6);
  });
});

// ─── extractContourSegments ───────────────────────────────────────────────────

describe('extractContourSegments', () => {
  it('uniform field below iso-value → no segments', () => {
    const scalars = new Float32Array(4 * 4).fill(0.5);
    const segs = extractContourSegments(scalars, 4, 4, 1.0);
    expect(segs.length).toBe(0);
  });

  it('uniform field above iso-value → no segments', () => {
    const scalars = new Float32Array(4 * 4).fill(2.0);
    const segs = extractContourSegments(scalars, 4, 4, 1.0);
    expect(segs.length).toBe(0);
  });

  it('simple step field: left half above, right half below → vertical contour segments', () => {
    // 4×4 grid: left 2 columns = 2.0, right 2 columns = 0.0
    const gridW = 4, gridH = 4;
    const scalars = new Float32Array(gridW * gridH);
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        scalars[j * gridW + i] = i < 2 ? 2.0 : 0.0;
      }
    }
    const segs = extractContourSegments(scalars, gridW, gridH, 1.0);
    // Each row of 2×2 cells that straddles the boundary should produce one vertical segment.
    expect(segs.length).toBeGreaterThan(0);
    // All segments should be near x ≈ 1.5 (midpoint between columns 1 and 2).
    for (const s of segs) {
      const midX = (s.x1 + s.x2) / 2;
      expect(midX).toBeCloseTo(1.5, 1);
    }
  });

  it('returns segments with fractional grid coordinates in valid range', () => {
    const gridW = 6, gridH = 5;
    // Random-ish values that cross iso-value 0.5.
    const scalars = new Float32Array(gridW * gridH);
    for (let k = 0; k < scalars.length; k++) {
      scalars[k] = (k % 3 === 0) ? 1.0 : 0.0;
    }
    const segs = extractContourSegments(scalars, gridW, gridH, 0.5);
    for (const s of segs) {
      expect(s.x1).toBeGreaterThanOrEqual(0);
      expect(s.x1).toBeLessThanOrEqual(gridW - 1);
      expect(s.y1).toBeGreaterThanOrEqual(0);
      expect(s.y1).toBeLessThanOrEqual(gridH - 1);
      expect(s.x2).toBeGreaterThanOrEqual(0);
      expect(s.x2).toBeLessThanOrEqual(gridW - 1);
      expect(s.y2).toBeGreaterThanOrEqual(0);
      expect(s.y2).toBeLessThanOrEqual(gridH - 1);
    }
  });

  it('grid smaller than 2×2 returns no segments', () => {
    const scalars = new Float32Array([1.0]);
    expect(extractContourSegments(scalars, 1, 1, 0.5).length).toBe(0);
    expect(extractContourSegments(scalars, 1, 2, 0.5).length).toBe(0);
    expect(extractContourSegments(scalars, 2, 1, 0.5).length).toBe(0);
  });

  it('segments derived from same buffer align with heatmap (same scalar source)', () => {
    // Build a signed scalar buffer; extract contour at +threshold and verify
    // that contour segments sit at the boundary between warm and cool regions.
    const gridW = 8, gridH = 8;
    const scalars = new Float32Array(gridW * gridH);
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        // Gradient: negative on left, positive on right.
        scalars[j * gridW + i] = (i / (gridW - 1)) * 2 - 1; // -1 to +1
      }
    }
    const threshold = 0.0; // iso-value at the sign change
    const segs = extractContourSegments(scalars, gridW, gridH, threshold);
    // There must be segments near the center column (x ≈ 3.5).
    expect(segs.length).toBeGreaterThan(0);
    const avgX = segs.reduce((sum, s) => sum + (s.x1 + s.x2) / 2, 0) / segs.length;
    expect(avgX).toBeCloseTo(3.5, 0); // roughly halfway
  });
});

// ─── getDefaultContourLevels ──────────────────────────────────────────────────

describe('getDefaultContourLevels', () => {
  it('signed mode: returns two levels, one positive and one negative', () => {
    const scalars = new Float32Array([0.5, -0.3, 0.8, -0.1]);
    const levels = getDefaultContourLevels('signed', scalars);
    expect(levels.length).toBe(2);
    const [pos, neg] = levels;
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeLessThan(0);
    expect(pos).toBeCloseTo(-neg, 9); // symmetric
  });

  it('envelope mode: returns exactly one non-negative level', () => {
    const scalars = new Float32Array([0.5, 0.3, 0.8, 0.1]);
    const levels = getDefaultContourLevels('envelope', scalars);
    expect(levels.length).toBe(1);
    expect(levels[0]).toBeGreaterThan(0);
  });

  it('all-zero input: levels are at or near MIN_CONTRAST_PEAK floor (not zero or NaN)', () => {
    const scalars = new Float32Array(16).fill(0);
    const signedLevels   = getDefaultContourLevels('signed',   scalars);
    const envelopeLevels = getDefaultContourLevels('envelope', scalars);

    for (const level of [...signedLevels, ...envelopeLevels]) {
      expect(Number.isFinite(level)).toBe(true);
      expect(Math.abs(level)).toBeGreaterThan(0);
    }
  });

  it('empty scalar buffer: returns finite non-NaN values', () => {
    const scalars = new Float32Array(0);
    const signedLevels   = getDefaultContourLevels('signed',   scalars);
    const envelopeLevels = getDefaultContourLevels('envelope', scalars);

    for (const level of [...signedLevels, ...envelopeLevels]) {
      expect(Number.isFinite(level)).toBe(true);
    }
    expect(signedLevels.length).toBe(2);
    expect(envelopeLevels.length).toBe(1);
  });

  it('larger field: threshold is strictly between 0 and peak', () => {
    const scalars = new Float32Array(100);
    for (let k = 0; k < 100; k++) scalars[k] = Math.sin(k * 0.3);
    const peak = Math.max(...Array.from(scalars).map(Math.abs));
    const [threshold] = getDefaultContourLevels('envelope', scalars.map(Math.abs) as Float32Array);
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThan(peak);
  });
});

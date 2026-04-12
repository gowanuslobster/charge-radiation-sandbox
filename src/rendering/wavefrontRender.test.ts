import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildHeatmapImageData,
  extractContourSegments,
  chainContourSegments,
  smoothScalars,
  bilinearUpsample,
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
  it('signed mode: returns exactly [0] — the zero-crossing phase boundary', () => {
    const scalars = new Float32Array([0.5, -0.3, 0.8, -0.1]);
    const levels = getDefaultContourLevels('signed', scalars);
    expect(levels.length).toBe(1);
    expect(levels[0]).toBe(0);
  });

  it('signed mode: always [0] regardless of field magnitude', () => {
    const scalars = new Float32Array([100, -100, 50, -50]);
    expect(getDefaultContourLevels('signed', scalars)).toEqual([0]);
  });

  it('envelope mode: returns exactly one positive level', () => {
    const scalars = new Float32Array([0.5, 0.3, 0.8, 0.1]);
    const levels = getDefaultContourLevels('envelope', scalars);
    expect(levels.length).toBe(1);
    expect(levels[0]).toBeGreaterThan(0);
  });

  it('envelope mode: level is 20% of contrastPeak, which is strictly between 0 and raw peak', () => {
    const scalars = new Float32Array(100);
    for (let k = 0; k < 100; k++) scalars[k] = Math.abs(Math.sin(k * 0.3));
    const rawPeak = Math.max(...Array.from(scalars));
    const [threshold] = getDefaultContourLevels('envelope', scalars);
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThan(rawPeak);
  });

  it('envelope all-zero input: returns a finite floor value, not zero or NaN', () => {
    const scalars = new Float32Array(16).fill(0);
    const [level] = getDefaultContourLevels('envelope', scalars);
    expect(Number.isFinite(level)).toBe(true);
    expect(level).toBeGreaterThan(0);
  });

  it('envelope empty buffer: returns a finite positive value', () => {
    const [level] = getDefaultContourLevels('envelope', new Float32Array(0));
    expect(Number.isFinite(level)).toBe(true);
    expect(level).toBeGreaterThan(0);
  });
});

// ─── chainContourSegments ─────────────────────────────────────────────────────

describe('chainContourSegments', () => {
  it('empty input → empty array', () => {
    expect(chainContourSegments([])).toEqual([]);
  });

  it('single segment → one chain of 4 coords', () => {
    const segs = [{ x1: 0, y1: 0, x2: 1, y2: 0 }];
    const chains = chainContourSegments(segs);
    expect(chains.length).toBe(1);
    expect(chains[0].length).toBe(4);
  });

  it('two connected segments → one chain of 6 coords', () => {
    // seg A: (0,0)→(1,0), seg B: (1,0)→(2,0) — share endpoint (1,0)
    const segs = [
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 1, y1: 0, x2: 2, y2: 0 },
    ];
    const chains = chainContourSegments(segs);
    expect(chains.length).toBe(1);
    expect(chains[0].length).toBe(6); // 3 unique vertices × 2 coords
  });

  it('two disconnected segments → two chains', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 3, y1: 3, x2: 4, y2: 3 },
    ];
    const chains = chainContourSegments(segs);
    expect(chains.length).toBe(2);
  });

  it('closed triangle → one chain with first point repeated at end', () => {
    // Three segments forming a triangle: A→B, B→C, C→A
    const segs = [
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 1, y1: 0, x2: 0.5, y2: 1 },
      { x1: 0.5, y1: 1, x2: 0, y2: 0 },
    ];
    const chains = chainContourSegments(segs);
    expect(chains.length).toBe(1);
    const c = chains[0];
    // Must have 8 coords (4 vertices: A, B, C, A repeated).
    expect(c.length).toBe(8);
    // First and last point must match.
    expect(c[0]).toBeCloseTo(c[c.length - 2], 9);
    expect(c[1]).toBeCloseTo(c[c.length - 1], 9);
  });

  it('all coords in chains are within the range of input segment endpoints', () => {
    // Use a real step-field contour to verify coordinate bounds.
    const gridW = 6, gridH = 4;
    const scalars = new Float32Array(gridW * gridH);
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        scalars[j * gridW + i] = i < 3 ? 2.0 : 0.0;
      }
    }
    const segs = extractContourSegments(scalars, gridW, gridH, 1.0);
    const chains = chainContourSegments(segs);
    expect(chains.length).toBeGreaterThan(0);
    for (const c of chains) {
      for (let k = 0; k < c.length; k += 2) {
        expect(c[k]).toBeGreaterThanOrEqual(0);
        expect(c[k]).toBeLessThanOrEqual(gridW - 1);
        expect(c[k + 1]).toBeGreaterThanOrEqual(0);
        expect(c[k + 1]).toBeLessThanOrEqual(gridH - 1);
      }
    }
  });

  it('total vertex count across all chains ≤ 2 × segment count (no extra vertices)', () => {
    const gridW = 8, gridH = 6;
    const scalars = new Float32Array(gridW * gridH);
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        scalars[j * gridW + i] = (i / (gridW - 1)) * 2 - 1; // -1 to +1
      }
    }
    const segs = extractContourSegments(scalars, gridW, gridH, 0.0);
    const chains = chainContourSegments(segs);
    const totalVertices = chains.reduce((s, c) => s + c.length / 2, 0);
    // Each segment contributes 2 endpoints; chaining merges shared ones,
    // so total vertices ≤ 2 × segment count (equality for fully disconnected).
    expect(totalVertices).toBeLessThanOrEqual(segs.length * 2);
  });
});

// ─── smoothScalars ────────────────────────────────────────────────────────────

describe('smoothScalars', () => {
  it('uniform field → output equals input', () => {
    const gridW = 4, gridH = 3;
    const src = new Float32Array(gridW * gridH).fill(5.0);
    const out = new Float32Array(gridW * gridH);
    smoothScalars(src, out, gridW, gridH);
    for (let k = 0; k < src.length; k++) {
      expect(out[k]).toBeCloseTo(5.0, 9);
    }
  });

  it('single peak → peak reduced; spreads to cardinal AND diagonal neighbors (isotropic kernel)', () => {
    const gridW = 3, gridH = 3;
    const src = new Float32Array(gridW * gridH); // all zero
    src[4] = 9.0; // center cell (i=1, j=1)
    const out = new Float32Array(gridW * gridH);
    smoothScalars(src, out, gridW, gridH);
    // Center: weight 4 out of 16 → 9 × 4/16 = 2.25
    expect(out[4]).toBeCloseTo(9 * 4 / 16, 5);
    // Cardinals: positive (weight-2 contribution from center)
    expect(out[1]).toBeGreaterThan(0); // top
    expect(out[7]).toBeGreaterThan(0); // bottom
    expect(out[3]).toBeGreaterThan(0); // left
    expect(out[5]).toBeGreaterThan(0); // right
    // Diagonals: also positive — isotropic improvement over old 5-point stencil
    expect(out[0]).toBeGreaterThan(0); // top-left
    expect(out[2]).toBeGreaterThan(0); // top-right
    expect(out[6]).toBeGreaterThan(0); // bottom-left
    expect(out[8]).toBeGreaterThan(0); // bottom-right
  });

  it('boundary cells use only available neighbors (no out-of-bounds bleed)', () => {
    // 3×1 grid: no vertical neighbors, no diagonals.
    const src = new Float32Array([1, 2, 3]);
    const out = new Float32Array(3);
    smoothScalars(src, out, 3, 1);
    // Left boundary: (1×4 + 2×2) / (4+2) = 8/6
    expect(out[0]).toBeCloseTo(8 / 6, 5);
    // Center: (2×4 + 1×2 + 3×2) / (4+2+2) = 16/8 = 2.0
    expect(out[1]).toBeCloseTo(2.0, 5);
    // Right boundary: (3×4 + 2×2) / (4+2) = 16/6
    expect(out[2]).toBeCloseTo(16 / 6, 5);
  });

  it('output buffer is distinct from input (no in-place aliasing)', () => {
    const src = new Float32Array([0, 1, 0, 1, 0]);
    const out = new Float32Array(5);
    smoothScalars(src, out, 5, 1);
    // src must be unchanged
    expect(Array.from(src)).toEqual([0, 1, 0, 1, 0]);
    // out must differ from src
    expect(Array.from(out)).not.toEqual(Array.from(src));
  });

  it('preserves sign structure — negative values remain negative', () => {
    // Alternating signs: smoothing should not flip signs for interior cells with same-sign neighbors.
    const src = new Float32Array([-1, -1, -1, -1, -1]);
    const out = new Float32Array(5);
    smoothScalars(src, out, 5, 1);
    for (const v of out) expect(v).toBeLessThan(0);
  });
});

// ─── bilinearUpsample ─────────────────────────────────────────────────────────

describe('bilinearUpsample', () => {
  it('scale=1 → exact copy of source', () => {
    const src = Float32Array.from([1, 2, 3, 4]);
    const dst = new Float32Array(4);
    bilinearUpsample(src, 2, 2, dst, 2, 2); // dstW=(2-1)*1+1=2
    expect(dst[0]).toBeCloseTo(1, 5);
    expect(dst[1]).toBeCloseTo(2, 5);
    expect(dst[2]).toBeCloseTo(3, 5);
    expect(dst[3]).toBeCloseTo(4, 5);
  });

  it('2×1 source, scale=3 → linear interpolation with exact endpoints', () => {
    // dstW = (2−1)×3+1 = 4
    const src = Float32Array.from([0, 1]);
    const dst = new Float32Array(4);
    bilinearUpsample(src, 2, 1, dst, 4, 1);
    expect(dst[0]).toBeCloseTo(0,     5);
    expect(dst[1]).toBeCloseTo(1 / 3, 5);
    expect(dst[2]).toBeCloseTo(2 / 3, 5);
    expect(dst[3]).toBeCloseTo(1,     5);
  });

  it('2×2 source, scale=3 → corner pixels reproduce exact source values', () => {
    // dstW = dstH = 4; src corners map exactly to dst corners
    const src = Float32Array.from([0, 1, 2, 3]); // TL, TR, BL, BR
    const dst = new Float32Array(16);
    bilinearUpsample(src, 2, 2, dst, 4, 4);
    expect(dst[0]).toBeCloseTo(0, 4);   // top-left
    expect(dst[3]).toBeCloseTo(1, 4);   // top-right
    expect(dst[12]).toBeCloseTo(2, 4);  // bottom-left
    expect(dst[15]).toBeCloseTo(3, 4);  // bottom-right
  });

  it('signed values interpolate through zero correctly', () => {
    // Zero crossing between the two source samples
    const src = Float32Array.from([-1, 1]);
    const dst = new Float32Array(4); // dstW=4 for scale=3
    bilinearUpsample(src, 2, 1, dst, 4, 1);
    // dst[1] negative, dst[2] positive — sign change falls between them
    expect(dst[1]).toBeLessThan(0);
    expect(dst[2]).toBeGreaterThan(0);
  });

  it('uniform source → all dest values equal source', () => {
    const src = new Float32Array(4).fill(7.5);
    const dst = new Float32Array(16); // 4×4 from 2×2, scale=3
    bilinearUpsample(src, 2, 2, dst, 4, 4);
    for (const v of dst) expect(v).toBeCloseTo(7.5, 5);
  });
});

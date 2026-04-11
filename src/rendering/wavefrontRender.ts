// wavefrontRender.ts — heatmap and contour rendering for the M6 wavefront overlay.
//
// Takes a signed bZAccel scalar grid (from wavefrontSampler) and produces:
//   - A coarse ImageData heatmap, upscaled to canvas resolution via drawImage.
//   - Contour line segments from marching squares.
//
// The caller (WavefrontOverlayCanvas) owns the mode decision:
//   - 'signed':   pass bZAccel as-is; warm/cool dual-hue color map.
//   - 'envelope': pass abs(bZAccel); warm single-hue color map.
//
// No physics imports. No React imports. Pure rendering utilities.

export type HeatmapMode = 'signed' | 'envelope';

export type WavefrontRenderWorkspace = {
  imageData: ImageData | null;
  offscreen: OffscreenCanvas | HTMLCanvasElement | null;
  offscreenCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
};

export function createRenderWorkspace(): WavefrontRenderWorkspace {
  return { imageData: null, offscreen: null, offscreenCtx: null };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_CONTRAST_PEAK = 1e-10;

// Dynamic-range compression constants per mode.
const SIGNED_K_PEAK  = 0.18;
const SIGNED_K_RMS   = 4.2;
const ENVELOPE_K_PEAK = 0.55;
const ENVELOPE_K_RMS  = 2.6;

// Warm amber (positive / envelope) and cool blue-violet (negative) palette colors.
const WARM_R = 255, WARM_G = 140, WARM_B = 30;
const COOL_R =  80, COOL_G = 100, COOL_B = 255;

// ── Shared normalization ──────────────────────────────────────────────────────

/**
 * Compute the dynamic-range ceiling used by both the heatmap and contour logic.
 * Keeping this in one place ensures contour levels are expressed in the same
 * normalized units as the heatmap display, so a given iso-value corresponds to
 * a predictable visible brightness.
 */
function computeContrastPeak(scalars: Float32Array, mode: HeatmapMode): number {
  let peak = 0;
  let sumSq = 0;
  for (let k = 0; k < scalars.length; k++) {
    const abs = Math.abs(scalars[k]);
    if (abs > peak) peak = abs;
    sumSq += abs * abs;
  }
  const rms = Math.sqrt(sumSq / Math.max(scalars.length, 1));
  const kPeak = mode === 'signed' ? SIGNED_K_PEAK : ENVELOPE_K_PEAK;
  const kRms  = mode === 'signed' ? SIGNED_K_RMS  : ENVELOPE_K_RMS;
  return Math.max(MIN_CONTRAST_PEAK, peak * kPeak, rms * kRms);
}

// ── buildHeatmapImageData ─────────────────────────────────────────────────────

/**
 * Build a gridW × gridH RGBA ImageData from a signed or envelope scalar buffer.
 *
 * Reuses the same ImageData object if dimensions are unchanged (no allocation churn).
 * Caller should supply scalars already mapped to the desired mode:
 *   - 'signed':   raw bZAccel (can be negative)
 *   - 'envelope': abs(bZAccel)
 */
export function buildHeatmapImageData(
  scalars: Float32Array,
  gridW: number,
  gridH: number,
  mode: HeatmapMode,
  workspace: WavefrontRenderWorkspace,
): ImageData {
  const n = gridW * gridH;

  // Reuse or allocate ImageData.
  if (
    workspace.imageData === null ||
    workspace.imageData.width  !== gridW ||
    workspace.imageData.height !== gridH
  ) {
    workspace.imageData = new ImageData(gridW, gridH);
  }
  const data = workspace.imageData.data;

  // Dynamic-range ceiling — shared with getDefaultContourLevels so contours
  // are expressed in the same normalized units as the heatmap display.
  const contrastPeak = computeContrastPeak(scalars, mode);

  for (let k = 0; k < n; k++) {
    const base = k * 4;
    const normalized = Math.max(-1, Math.min(1, scalars[k] / contrastPeak));

    if (mode === 'signed') {
      // Transfer: tanh compression, hue from sign, strength from magnitude.
      const shaped   = Math.tanh(normalized * 1.4); // in (−1, 1)
      const strength = Math.pow(Math.abs(shaped), 0.82);
      const alpha    = Math.round(strength * 255);

      if (alpha === 0) {
        data[base] = 0; data[base + 1] = 0; data[base + 2] = 0; data[base + 3] = 0;
      } else if (shaped >= 0) {
        data[base]     = WARM_R;
        data[base + 1] = WARM_G;
        data[base + 2] = WARM_B;
        data[base + 3] = alpha;
      } else {
        data[base]     = COOL_R;
        data[base + 1] = COOL_G;
        data[base + 2] = COOL_B;
        data[base + 3] = alpha;
      }
    } else {
      // Envelope: normalized is already ≥ 0 (caller passed abs values).
      const strength = Math.pow(Math.max(0, normalized), 0.78);
      const alpha    = Math.round(strength * 255);

      if (alpha === 0) {
        data[base] = 0; data[base + 1] = 0; data[base + 2] = 0; data[base + 3] = 0;
      } else {
        data[base]     = WARM_R;
        data[base + 1] = WARM_G;
        data[base + 2] = WARM_B;
        data[base + 3] = alpha;
      }
    }
  }

  return workspace.imageData;
}

// ── drawHeatmap ───────────────────────────────────────────────────────────────

/**
 * Upscale the coarse ImageData to full canvas resolution via an offscreen canvas
 * and drawImage (browser bilinear interpolation).
 *
 * The workspace offscreen canvas is created / replaced only when gridW or gridH changes.
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  gridW: number,
  gridH: number,
  canvasW: number,
  canvasH: number,
  workspace: WavefrontRenderWorkspace,
  alpha: number,
): void {
  // Ensure offscreen canvas is the right size.
  const needNew =
    workspace.offscreen === null ||
    workspace.offscreen.width  !== gridW ||
    workspace.offscreen.height !== gridH;

  if (needNew) {
    if (typeof OffscreenCanvas !== 'undefined') {
      const oc = new OffscreenCanvas(gridW, gridH);
      workspace.offscreen = oc;
      workspace.offscreenCtx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D;
    } else {
      const c = document.createElement('canvas');
      c.width  = gridW;
      c.height = gridH;
      workspace.offscreen = c;
      workspace.offscreenCtx = c.getContext('2d');
    }
  }

  if (workspace.offscreenCtx === null) return;

  workspace.offscreenCtx.putImageData(imageData, 0, 0);

  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.drawImage(workspace.offscreen as CanvasImageSource, 0, 0, canvasW, canvasH);
  ctx.globalAlpha = prevAlpha;
}

// ── Contour extraction (marching squares) ─────────────────────────────────────

export type ContourSegment = {
  /** Fractional grid coordinates [0, gridW−1] × [0, gridH−1]; caller maps to screen. */
  x1: number; y1: number;
  x2: number; y2: number;
};

/**
 * Extract iso-contour line segments for `isoValue` from a scalar grid.
 * Uses standard marching squares over each 2×2 block of grid points.
 * Outputs fractional grid coordinates (i.e., top-left corner is (0, 0),
 * bottom-right is (gridW−1, gridH−1)).
 */
export function extractContourSegments(
  scalars: Float32Array,
  gridW: number,
  gridH: number,
  isoValue: number,
): ContourSegment[] {
  const segments: ContourSegment[] = [];
  if (gridW < 2 || gridH < 2) return segments;

  for (let j = 0; j < gridH - 1; j++) {
    for (let i = 0; i < gridW - 1; i++) {
      // Sample the four corners of the 2×2 cell (top-left, top-right, bottom-right, bottom-left).
      const v0 = scalars[j * gridW + i];           // top-left
      const v1 = scalars[j * gridW + (i + 1)];     // top-right
      const v2 = scalars[(j + 1) * gridW + (i + 1)]; // bottom-right
      const v3 = scalars[(j + 1) * gridW + i];     // bottom-left

      const b0 = v0 >= isoValue ? 1 : 0;
      const b1 = v1 >= isoValue ? 1 : 0;
      const b2 = v2 >= isoValue ? 1 : 0;
      const b3 = v3 >= isoValue ? 1 : 0;
      const caseIndex = (b0 << 3) | (b1 << 2) | (b2 << 1) | b3;

      if (caseIndex === 0 || caseIndex === 15) continue; // entirely inside or outside

      // Linear interpolation along an edge, returning fraction [0, 1].
      const lerp = (a: number, b: number) => {
        const d = b - a;
        return d === 0 ? 0.5 : Math.max(0, Math.min(1, (isoValue - a) / d));
      };

      // Edge midpoints in fractional grid coords.
      const top    = { x: i + lerp(v0, v1), y: j };             // top edge
      const right  = { x: i + 1,            y: j + lerp(v1, v2) }; // right edge
      const bottom = { x: i + lerp(v3, v2), y: j + 1 };         // bottom edge
      const left   = { x: i,                y: j + lerp(v0, v3) }; // left edge

      // Emit segments based on marching-squares case.
      // Cases 5 and 10 are ambiguous — we pick the same resolution for both orientations.
      const addSeg = (p: {x:number;y:number}, q: {x:number;y:number}) => {
        segments.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      };

      switch (caseIndex) {
        case  1: addSeg(left, bottom); break;
        case  2: addSeg(bottom, right); break;
        case  3: addSeg(left, right); break;
        case  4: addSeg(top, right); break;
        case  5: addSeg(top, left); addSeg(bottom, right); break; // ambiguous: saddle
        case  6: addSeg(top, bottom); break;
        case  7: addSeg(top, left); break;
        case  8: addSeg(top, left); break;
        case  9: addSeg(top, bottom); break;
        case 10: addSeg(top, right); addSeg(left, bottom); break; // ambiguous: saddle
        case 11: addSeg(top, right); break;
        case 12: addSeg(left, right); break;
        case 13: addSeg(bottom, right); break;
        case 14: addSeg(left, bottom); break;
      }
    }
  }

  return segments;
}

// ── chainContourSegments ──────────────────────────────────────────────────────

/**
 * Chain an unordered array of marching-squares segments into continuous polylines.
 * Returns flat [x0, y0, x1, y1, ...] coordinate arrays (one per polyline).
 * Closed loops have their first point repeated at the end.
 *
 * Endpoint matching uses quantized integer keys to avoid string allocation.
 * QUANTIZE_FACTOR must be large enough that distinct edge points round to different
 * keys, but small enough that the same edge point from two adjacent cells rounds to
 * the same key. At grid resolution (coords in [0, ~96] × [0, ~54]), a factor of 1000
 * gives sub-cell precision and is robust to future changes in lerp ordering.
 * QUANTIZE_STRIDE must exceed gridW * QUANTIZE_FACTOR (96 × 1000 = 96000 < 200000).
 */
const QUANTIZE_FACTOR = 1000;
const QUANTIZE_STRIDE = 200000;

export function chainContourSegments(segments: ContourSegment[]): number[][] {
  const n = segments.length;
  if (n === 0) return [];

  const qk = (x: number, y: number): number =>
    Math.round(y * QUANTIZE_FACTOR) * QUANTIZE_STRIDE + Math.round(x * QUANTIZE_FACTOR);

  // Map: quantized endpoint key → up to two (segIndex, endIndex) entries.
  // Each grid edge point is shared by at most two segments; using arrays avoids the
  // silent-overwrite problem that single-entry maps have at junction vertices.
  type Entry = [number, 0 | 1];
  const map = new Map<number, Entry[]>();
  const addToMap = (key: number, entry: Entry) => {
    const existing = map.get(key);
    if (existing) existing.push(entry);
    else map.set(key, [entry]);
  };
  for (let i = 0; i < n; i++) {
    const s = segments[i];
    addToMap(qk(s.x1, s.y1), [i, 0]);
    addToMap(qk(s.x2, s.y2), [i, 1]);
  }

  // Find a neighbor at `key` that is not `excludeSeg` and not yet visited.
  const findNeighbor = (key: number, excludeSeg: number): Entry | undefined =>
    map.get(key)?.find(([si]) => si !== excludeSeg && !visited[si]);

  const visited = new Uint8Array(n);
  const chains: number[][] = [];

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;

    // Walk backward to find the true head of this chain.
    // Stops at a dead-end or when a closed loop is detected (would cycle back to start).
    let headSeg = start;
    let headEnd: 0 | 1 = 0;
    for (;;) {
      const s = segments[headSeg];
      const tailKey = headEnd === 0 ? qk(s.x1, s.y1) : qk(s.x2, s.y2);
      const nb = findNeighbor(tailKey, headSeg);
      if (!nb || nb[0] === start) break; // dead-end or closed loop
      headSeg = nb[0];
      headEnd = nb[1]; // enter the predecessor from the shared endpoint's side
    }

    // Walk forward, collecting flat [x, y, x, y, ...] coordinates.
    // `end` = which endpoint of the current segment we entered from.
    const pts: number[] = [];
    let cur = headSeg;
    let end: 0 | 1 = headEnd;

    const pushEntry = (seg: number, e: 0 | 1) => {
      const s = segments[seg];
      pts.push(e === 0 ? s.x1 : s.x2, e === 0 ? s.y1 : s.y2);
    };
    const pushExit = (seg: number, e: 0 | 1) => {
      const s = segments[seg];
      pts.push(e === 0 ? s.x2 : s.x1, e === 0 ? s.y2 : s.y1);
    };

    pushEntry(cur, end);
    for (;;) {
      if (visited[cur]) break;
      visited[cur] = 1;
      pushExit(cur, end);

      const s = segments[cur];
      const nextKey = end === 0 ? qk(s.x2, s.y2) : qk(s.x1, s.y1);
      const nb = findNeighbor(nextKey, cur);
      if (!nb) break;
      cur = nb[0];
      end = nb[1]; // enter next segment from the shared endpoint's side
    }

    if (pts.length >= 4) chains.push(pts);
  }

  return chains;
}

// ── smoothScalars ─────────────────────────────────────────────────────────────

/**
 * Apply one pass of a 5-point averaging stencil (center + 4 cardinal neighbors)
 * to a scalar grid, writing results into `out` (must be same length as `src`).
 * Boundary cells use only the available neighbors (no wrap, no ghost cells).
 *
 * IMPORTANT: Call this on the SIGNED scalar buffer before any abs() conversion.
 * Smoothing after abs() destroys sign-cancellation structure at phase boundaries
 * and can thicken or distort features in a physically misleading way.
 */
export function smoothScalars(
  src: Float32Array,
  out: Float32Array,
  gridW: number,
  gridH: number,
): void {
  for (let j = 0; j < gridH; j++) {
    for (let i = 0; i < gridW; i++) {
      const idx = j * gridW + i;
      let sum = src[idx];
      let count = 1;
      if (i > 0)         { sum += src[idx - 1];      count++; }
      if (i < gridW - 1) { sum += src[idx + 1];      count++; }
      if (j > 0)         { sum += src[idx - gridW];  count++; }
      if (j < gridH - 1) { sum += src[idx + gridW];  count++; }
      out[idx] = sum / count;
    }
  }
}

// ── getDefaultContourLevels ───────────────────────────────────────────────────

/**
 * Return the iso-value(s) for contour extraction, expressed in raw scalar units.
 *
 *   - 'signed'  (oscillating): [0] — the zero crossing, which is the phase boundary
 *     between positive and negative radiation lobes. Physically meaningful and stable.
 *
 *   - 'envelope' (moving_charge / transients): [0.20 × contrastPeak] — 20% of the
 *     heatmap's display range, so the contour corresponds to a predictable brightness
 *     in the heatmap. Traces the visible edge of the radiation pulse.
 *
 * Uses the same contrastPeak computation as buildHeatmapImageData so levels stay
 * synchronized with what the student sees in the color display.
 */
export function getDefaultContourLevels(
  mode: HeatmapMode,
  scalars: Float32Array,
): number[] {
  if (mode === 'signed') return [0];
  return [0.20 * computeContrastPeak(scalars, mode)];
}

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

  // Compute stats.
  let peak = 0;
  let sumSq = 0;
  for (let k = 0; k < n; k++) {
    const abs = Math.abs(scalars[k]);
    if (abs > peak) peak = abs;
    sumSq += abs * abs;
  }
  const rms = Math.sqrt(sumSq / n);

  // Dynamic-range ceiling.
  const kPeak = mode === 'signed' ? SIGNED_K_PEAK  : ENVELOPE_K_PEAK;
  const kRms  = mode === 'signed' ? SIGNED_K_RMS   : ENVELOPE_K_RMS;
  const contrastPeak = Math.max(MIN_CONTRAST_PEAK, peak * kPeak, rms * kRms);

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

// ── getDefaultContourLevels ───────────────────────────────────────────────────

/**
 * Return recommended iso-values for the given mode and scalar buffer.
 *   - 'signed':   [+threshold, -threshold] based on RMS — two levels for two stroke colors.
 *   - 'envelope': [threshold] — one positive level.
 *
 * All-zero input returns a floor value rather than NaN or zero.
 */
export function getDefaultContourLevels(
  mode: HeatmapMode,
  scalars: Float32Array,
): number[] {
  const n = scalars.length;
  if (n === 0) {
    const floor = MIN_CONTRAST_PEAK;
    return mode === 'signed' ? [floor, -floor] : [floor];
  }

  let peak = 0;
  let sumSq = 0;
  for (let k = 0; k < n; k++) {
    const abs = Math.abs(scalars[k]);
    if (abs > peak) peak = abs;
    sumSq += abs * abs;
  }
  const rms = Math.sqrt(sumSq / n);

  // Use the same contrast-peak calculation as the heatmap for alignment.
  const kPeak = mode === 'signed' ? SIGNED_K_PEAK  : ENVELOPE_K_PEAK;
  const kRms  = mode === 'signed' ? SIGNED_K_RMS   : ENVELOPE_K_RMS;
  const contrastPeak = Math.max(MIN_CONTRAST_PEAK, peak * kPeak, rms * kRms);

  // Threshold at ~35% of the contrast peak — visible but not right at the noise floor.
  const threshold = contrastPeak * 0.35;

  return mode === 'signed' ? [threshold, -threshold] : [threshold];
}

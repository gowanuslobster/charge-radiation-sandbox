// WavefrontOverlayCanvas — CPU fallback canvas for the magnetic-field overlay.
//
// Owns a DOM canvas, ResizeObserver, and RAF loop. Physics sampling is done via
// wavefrontSampler (which now returns bZ / bZVel / bZAccel per call); pixel
// rendering via wavefrontRender. The heatmap displays the signed channel
// selected by `heatmapChannel`. The wavefront contour, when enabled, is always
// derived from bZAccel — it is a radiation annotation, not a magnetic isoline.
//
// Grid sizing: world-space driven — one sample per TARGET_WORLD_CELL_FACTOR * c
// world units. Cap at MAX_GRID_CELLS total, scale both axes proportionally.
// This keeps sampling fidelity stable across zoom levels.
//
// Normalization is mode-aware and per-channel, matching WavefrontWebGLCanvas:
//   Policy A (moving_charge, draggable)  — dynamic EMA.
//   Policy B (oscillating, dipole, hydrogen) — phase-invariant cached peak.
//
// Stacking: position:absolute inset:0, zIndex:10 (below VectorFieldCanvas at z-15).

import { useEffect, useRef, type CSSProperties, type RefObject, type MutableRefObject } from 'react';
import type { SimConfig } from '@/physics/types';
import type { ChargeRuntime } from '@/physics/chargeRuntime';
import {
  type DemoMode,
  type MagneticHeatmapMode,
  DIPOLE_OMEGA,
  HYDROGEN_OMEGA,
  OSCILLATING_OMEGA,
} from '@/physics/demoModes';
import type { WorldBounds } from '@/rendering/worldSpace';
import {
  createSamplerState,
  sampleWavefront,
  type WavefrontSamplerState,
} from '@/physics/wavefrontSampler';
import {
  createRenderWorkspace,
  buildHeatmapImageData,
  drawHeatmap,
  extractContourSegments,
  chainContourSegments,
  smoothScalars,
  bilinearUpsample,
  computeContrastPeak,
  getDefaultContourLevels,
  type HeatmapMode,
  type WavefrontRenderWorkspace,
} from '@/rendering/wavefrontRender';

// World-space grid sizing constants.
// One sample every (TARGET_WORLD_CELL_FACTOR * c) world units keeps fidelity
// proportional to the physical wavelength/shell-width regardless of zoom.
const TARGET_WORLD_CELL_FACTOR = 0.20;
const MAX_GRID_CELLS = 16384;

// Render-lattice upscale: each coarse grid interval becomes RENDER_SCALE render
// intervals. renderW = (gridW − 1) × RENDER_SCALE + 1 (align-corners).
const RENDER_SCALE     = 3;
const MAX_RENDER_CELLS = 200_000; // fallback reduces scale to 2, then 1, if exceeded

// Smoothing passes. 1 is the correct starting point; increase only if visual review warrants it.
const SMOOTH_PASSES_SIGNED = 1;

// Normalization-policy constants (match WavefrontWebGLCanvas).
const NORM_PROBE_W   = 32;
const NORM_PROBE_H   = 32;
const NORM_EMA_ALPHA = 0.12;
const PERIODIC_NORM_PHASE_SAMPLES = 8;

// Channel indices (match WavefrontWebGLCanvas).
const CHANNEL_TOTAL = 0;
const CHANNEL_VEL   = 1;
const CHANNEL_ACCEL = 2;

type Props = {
  chargeRuntimesRef: RefObject<ChargeRuntime[]>;
  simulationTimeRef: MutableRefObject<number>;
  configRef: MutableRefObject<SimConfig>;
  simEpochRef: MutableRefObject<number>;
  bounds: WorldBounds;
  demoMode: DemoMode;
  heatmapChannel: MagneticHeatmapMode;
  showContours: boolean;
  isPausedRef: MutableRefObject<boolean>;
  style?: CSSProperties;
};

// Contour stroke color: near-white for both modes, matching the GPU shader path.
const CONTOUR_PHASE    = 'rgba(220, 220, 220, 0.85)';
const CONTOUR_LINE_WIDTH = 1.5;

function periodicModePeriod(mode: DemoMode): number | null {
  if (mode === 'oscillating') return (2 * Math.PI) / OSCILLATING_OMEGA;
  if (mode === 'dipole')      return (2 * Math.PI) / DIPOLE_OMEGA;
  if (mode === 'hydrogen')    return (2 * Math.PI) / HYDROGEN_OMEGA;
  return null;
}

function channelIndex(channel: MagneticHeatmapMode): number {
  if (channel === 'total') return CHANNEL_TOTAL;
  if (channel === 'vel')   return CHANNEL_VEL;
  if (channel === 'accel') return CHANNEL_ACCEL;
  return -1; // 'off'
}

/**
 * Draw chained polylines as plain line segments.
 * Each chain is a flat [x0, y0, x1, y1, ...] array in fractional render-lattice coords.
 * At 3× upscale the lattice is fine enough that Bézier smoothing is unnecessary
 * and would only pull contour lines away from the underlying iso-surface.
 */
function strokeChains(
  ctx: CanvasRenderingContext2D,
  chains: number[][],
  toScreenX: (x: number) => number,
  toScreenY: (y: number) => number,
): void {
  ctx.beginPath();
  for (const pts of chains) {
    const nv = pts.length >> 1;
    if (nv < 2) continue;
    ctx.moveTo(toScreenX(pts[0]), toScreenY(pts[1]));
    for (let i = 1; i < nv; i++) {
      ctx.lineTo(toScreenX(pts[i * 2]), toScreenY(pts[i * 2 + 1]));
    }
    const closed =
      pts[0] === pts[(nv - 1) * 2] &&
      pts[1] === pts[(nv - 1) * 2 + 1];
    if (closed) ctx.closePath();
  }
  ctx.stroke();
}

export function WavefrontOverlayCanvas({
  chargeRuntimesRef,
  simulationTimeRef,
  configRef,
  simEpochRef,
  bounds,
  demoMode,
  heatmapChannel,
  showContours,
  isPausedRef,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mirror props into refs so the RAF closure always reads current values
  // without needing to restart the effect when props change.
  const boundsRef           = useRef(bounds);
  const demoModeRef         = useRef(demoMode);
  const heatmapChannelRef   = useRef(heatmapChannel);
  const showContoursRef     = useRef(showContours);
  useEffect(() => { boundsRef.current         = bounds;         }, [bounds]);
  useEffect(() => { demoModeRef.current       = demoMode;       }, [demoMode]);
  useEffect(() => { heatmapChannelRef.current = heatmapChannel; }, [heatmapChannel]);
  useEffect(() => { showContoursRef.current   = showContours;   }, [showContours]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Per-charge sampler states — one entry per charge in chargeRuntimesRef.current.
    // Resized inside the frame function when charge count changes (multi-charge ↔ single).
    let samplerStates: WavefrontSamplerState[] = [];
    // Dedicated sampler states for Policy B phase-sweep probe (never mixed with render states).
    const normSamplerStates: WavefrontSamplerState[] = [];
    const renderWorkspace: WavefrontRenderWorkspace = createRenderWorkspace();

    // Per-channel coarse scalar buffers (summed across charges). Reused across frames.
    let coarseTotal: Float32Array = new Float32Array(0);
    let coarseVel:   Float32Array = new Float32Array(0);
    let coarseAccel: Float32Array = new Float32Array(0);
    let hasCachedCoarse = false;

    // Reused buffers for the smoothed scalars (coarse grid). Resized when grid changes.
    let smoothedScalarsBuffer: Float32Array = new Float32Array(0);
    let smoothPingBuffer:      Float32Array = new Float32Array(0);
    // Bilinearly upscaled signed fields on the render lattice.
    let upscaledHeatmap: Float32Array = new Float32Array(0);
    let upscaledAccel:   Float32Array = new Float32Array(0);
    // Abs-mapped upscaled accel field — used for moving_charge contour threshold detection.
    let upscaledAccelAbs: Float32Array = new Float32Array(0);

    // Derived-render cache — reused across frames when physics, mode, channel, and
    // render dims are unchanged.
    let cachedHeatmapImageData: ImageData | null = null;
    let cachedHeatmapPeak = 0;      // peak used to render the heatmap (selected channel)
    let cachedAccelPeak   = 0;      // peak of bZAccel (envelope-contour threshold source)
    let cachedContourAbsPeak = 0;   // peak of |bZAccel| (envelope contour level input)
    let lastRenderedChannel: MagneticHeatmapMode = 'off';
    let lastRenderedContourMode = '';
    let lastRenderW = -1;
    let lastRenderH = -1;
    const cachedChains: Map<number, number[][]> = new Map();

    // Solve-phase cache keys (re-use coarse buffers when inputs unchanged).
    let lastSolvedSimTime = NaN;
    let lastSolvedEpoch = -1;
    let lastSolvedMinX = NaN;
    let lastSolvedMaxX = NaN;
    let lastSolvedMinY = NaN;
    let lastSolvedMaxY = NaN;
    let lastSolvedC = NaN;
    let lastGridW = -1;
    let lastGridH = -1;
    let lastChargeCount = -1;

    // ── Mode-aware per-channel normalization state (mirrors WebGL path) ─────────
    const smoothedPeaks = new Float64Array(3);  // Policy A
    const cachedPeaks   = new Float64Array(3);  // Policy B
    let cachedPeaksValid = false;

    let prevNormEpoch       = NaN;
    let prevNormMode        = '' as DemoMode;
    let prevNormC           = NaN;
    let prevNormChargeCount = -1;
    const prevNormChargeVals = new Float64Array(8).fill(NaN); // tolerant upper bound
    let prevNormBounds      = { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN } as WorldBounds;

    // Probe scratch buffers (per-channel).
    const probeScratchTotal = new Float32Array(NORM_PROBE_W * NORM_PROBE_H);
    const probeScratchVel   = new Float32Array(NORM_PROBE_W * NORM_PROBE_H);
    const probeScratchAccel = new Float32Array(NORM_PROBE_W * NORM_PROBE_H);

    let rafId: number;

    const ro = new ResizeObserver(() => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      canvas.width  = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.scale(dpr, dpr);
    });
    ro.observe(canvas);

    function frame() {
      rafId = requestAnimationFrame(frame);
      if (!canvas || !ctx) return;

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;

      ctx.clearRect(0, 0, cssW, cssH);

      const channel     = heatmapChannelRef.current;
      const wantHeatmap = channel !== 'off';
      const wantContours = showContoursRef.current;
      if (!wantHeatmap && !wantContours) return;

      const currentBounds  = boundsRef.current;
      const mode = demoModeRef.current;

      // Grid dimensions: world-space driven so fidelity is stable across zoom levels.
      const spanX = currentBounds.maxX - currentBounds.minX;
      const spanY = currentBounds.maxY - currentBounds.minY;
      const targetCellSize = TARGET_WORLD_CELL_FACTOR * configRef.current.c;
      const rawGridW = Math.ceil(spanX / targetCellSize) + 1;
      const rawGridH = Math.ceil(spanY / targetCellSize) + 1;
      const rawTotal = rawGridW * rawGridH;
      const gridScale = rawTotal > MAX_GRID_CELLS ? Math.sqrt(MAX_GRID_CELLS / rawTotal) : 1;
      const gridW = Math.max(4, Math.round(rawGridW * gridScale));
      const gridH = Math.max(4, Math.round(rawGridH * gridScale));

      // Render-lattice dimensions using align-corners formula.
      const renderDim = (n: number, s: number) => (n - 1) * s + 1;
      let renderScale = RENDER_SCALE;
      if (renderDim(gridW, renderScale) * renderDim(gridH, renderScale) > MAX_RENDER_CELLS) renderScale = 2;
      if (renderDim(gridW, renderScale) * renderDim(gridH, renderScale) > MAX_RENDER_CELLS) renderScale = 1;
      const renderW = renderDim(gridW, renderScale);
      const renderH = renderDim(gridH, renderScale);

      // Heatmap always uses signed coloring (warm/cool dual-hue) for all channels.
      // Contour logic: periodic modes use zero-crossing on the signed bZAccel field;
      // moving_charge uses an envelope threshold on the |bZAccel| field.
      // (draggable hides the contour toggle entirely — value is irrelevant there.)
      const contourMode: HeatmapMode =
        (mode === 'oscillating' || mode === 'dipole' || mode === 'hydrogen')
          ? 'signed' : 'envelope';

      const currentSimTime   = simulationTimeRef.current;
      const currentEpoch     = simEpochRef.current;
      const paused           = isPausedRef.current;
      const chargeRuntimes   = chargeRuntimesRef.current;

      // Keep samplerStates array in sync with current charge count.
      while (samplerStates.length < chargeRuntimes.length) samplerStates.push(createSamplerState());
      if (samplerStates.length > chargeRuntimes.length) samplerStates = samplerStates.slice(0, chargeRuntimes.length);
      while (normSamplerStates.length < chargeRuntimes.length) normSamplerStates.push(createSamplerState());

      const needsSolve =
        !paused ||
        !hasCachedCoarse ||
        currentSimTime !== lastSolvedSimTime ||
        currentEpoch   !== lastSolvedEpoch   ||
        currentBounds.minX !== lastSolvedMinX ||
        currentBounds.maxX !== lastSolvedMaxX ||
        currentBounds.minY !== lastSolvedMinY ||
        currentBounds.maxY !== lastSolvedMaxY ||
        configRef.current.c !== lastSolvedC    ||
        gridW !== lastGridW ||
        gridH !== lastGridH ||
        chargeRuntimes.length !== lastChargeCount;

      if (needsSolve) {
        const n = gridW * gridH;
        if (coarseTotal.length !== n) {
          coarseTotal = new Float32Array(n);
          coarseVel   = new Float32Array(n);
          coarseAccel = new Float32Array(n);
        } else {
          coarseTotal.fill(0);
          coarseVel.fill(0);
          coarseAccel.fill(0);
        }

        const sampleBounds = {
          minX: currentBounds.minX,
          maxX: currentBounds.maxX,
          minY: currentBounds.minY,
          maxY: currentBounds.maxY,
        };

        // Sample each charge's three Bz components and sum elementwise.
        // One retarded-time solve per cell per charge feeds all three buffers.
        for (let ci = 0; ci < chargeRuntimes.length; ci++) {
          const { history, charge } = chargeRuntimes[ci];
          const samples = sampleWavefront(samplerStates[ci], {
            history,
            simTime:  currentSimTime,
            charge,
            config:   configRef.current,
            bounds:   sampleBounds,
            gridW,
            gridH,
            simEpoch: currentEpoch,
          });
          for (let k = 0; k < n; k++) {
            coarseTotal[k] += samples.bZ[k];
            coarseVel[k]   += samples.bZVel[k];
            coarseAccel[k] += samples.bZAccel[k];
          }
        }

        hasCachedCoarse   = true;
        lastSolvedSimTime = currentSimTime;
        lastSolvedEpoch   = currentEpoch;
        lastSolvedMinX    = currentBounds.minX;
        lastSolvedMaxX    = currentBounds.maxX;
        lastSolvedMinY    = currentBounds.minY;
        lastSolvedMaxY    = currentBounds.maxY;
        lastSolvedC       = configRef.current.c;
        lastGridW         = gridW;
        lastGridH         = gridH;
        lastChargeCount   = chargeRuntimes.length;
      }

      // ── Mode-aware normalization ─────────────────────────────────────────────
      const epochChanged   = currentEpoch !== prevNormEpoch;
      const modeChanged    = mode         !== prevNormMode;
      const cChanged       = configRef.current.c !== prevNormC;
      let   chargesChanged = chargeRuntimes.length !== prevNormChargeCount;
      if (!chargesChanged) {
        for (let ci = 0; ci < chargeRuntimes.length; ci++) {
          if (chargeRuntimes[ci].charge !== prevNormChargeVals[ci]) { chargesChanged = true; break; }
        }
      }
      const boundsChanged =
        currentBounds.minX !== prevNormBounds.minX ||
        currentBounds.maxX !== prevNormBounds.maxX ||
        currentBounds.minY !== prevNormBounds.minY ||
        currentBounds.maxY !== prevNormBounds.maxY;

      // NOTE: channel switches deliberately do NOT invalidate the cached peaks.
      // Both Policy B's cache and Policy A's EMA store all three channel slots,
      // populated together on every probe. Flipping the heatmap channel just
      // selects a different slot; no recompute is needed.
      const hardReset  = epochChanged || modeChanged || cChanged || chargesChanged;
      const invalidate = hardReset || boundsChanged;
      const period     = periodicModePeriod(mode);
      const policyB    = period !== null;

      const runProbe = (probeTime: number): [number, number, number] => {
        probeScratchTotal.fill(0);
        probeScratchVel.fill(0);
        probeScratchAccel.fill(0);
        for (let ci = 0; ci < chargeRuntimes.length; ci++) {
          const { history: h, charge: q } = chargeRuntimes[ci];
          if (!h || h.isEmpty()) continue;
          const samples = sampleWavefront(normSamplerStates[ci], {
            history: h,
            simTime:  probeTime,
            charge:   q,
            config:   configRef.current,
            bounds:   currentBounds,
            gridW:    NORM_PROBE_W,
            gridH:    NORM_PROBE_H,
            simEpoch: currentEpoch,
          });
          for (let k = 0; k < probeScratchTotal.length; k++) {
            probeScratchTotal[k] += samples.bZ[k];
            probeScratchVel[k]   += samples.bZVel[k];
            probeScratchAccel[k] += samples.bZAccel[k];
          }
        }
        return [
          computeContrastPeak(probeScratchTotal, 'signed'),
          computeContrastPeak(probeScratchVel,   'signed'),
          computeContrastPeak(probeScratchAccel, 'signed'),
        ];
      };

      if (policyB) {
        if (invalidate) cachedPeaksValid = false;
        if (!cachedPeaksValid) {
          const T = period as number;
          const N = PERIODIC_NORM_PHASE_SAMPLES;
          let maxT = 0, maxV = 0, maxA = 0;
          for (let si = 0; si < N; si++) {
            const probeTime = currentSimTime - (si * T) / N;
            const [pt, pv, pa] = runProbe(probeTime);
            if (pt > maxT) maxT = pt;
            if (pv > maxV) maxV = pv;
            if (pa > maxA) maxA = pa;
          }
          cachedPeaks[CHANNEL_TOTAL] = maxT;
          cachedPeaks[CHANNEL_VEL]   = maxV;
          cachedPeaks[CHANNEL_ACCEL] = maxA;
          cachedPeaksValid = true;
        }
      } else {
        if (hardReset) { smoothedPeaks[0] = 0; smoothedPeaks[1] = 0; smoothedPeaks[2] = 0; }
        const needsProbe = hardReset || !paused || boundsChanged;
        if (needsProbe) {
          const [rt, rv, ra] = runProbe(currentSimTime);
          const raw: [number, number, number] = [rt, rv, ra];
          for (let k = 0; k < 3; k++) {
            if (hardReset || smoothedPeaks[k] === 0) {
              smoothedPeaks[k] = raw[k];
            } else {
              smoothedPeaks[k] = NORM_EMA_ALPHA * raw[k] + (1 - NORM_EMA_ALPHA) * smoothedPeaks[k];
            }
          }
        }
      }

      prevNormEpoch       = currentEpoch;
      prevNormMode        = mode;
      prevNormC           = configRef.current.c;
      prevNormChargeCount = chargeRuntimes.length;
      for (let ci = 0; ci < chargeRuntimes.length; ci++) prevNormChargeVals[ci] = chargeRuntimes[ci].charge;
      for (let ci = chargeRuntimes.length; ci < prevNormChargeVals.length; ci++) prevNormChargeVals[ci] = NaN;
      prevNormBounds      = { ...currentBounds };

      const activePeaks = policyB ? cachedPeaks : smoothedPeaks;
      const chIdx       = channelIndex(channel);
      const heatmapPeak = Math.max(chIdx >= 0 ? activePeaks[chIdx] : 0, 1e-10);
      const accelPeak   = Math.max(activePeaks[CHANNEL_ACCEL], 1e-10);

      // Resize coarse-grid smoothing buffers when dimensions change.
      if (smoothedScalarsBuffer.length !== gridW * gridH) {
        smoothedScalarsBuffer = new Float32Array(gridW * gridH);
        smoothPingBuffer      = new Float32Array(gridW * gridH);
      }
      // Resize render-lattice buffers when dimensions change.
      const renderN = renderW * renderH;
      if (upscaledHeatmap.length !== renderN) {
        upscaledHeatmap  = new Float32Array(renderN);
        upscaledAccel    = new Float32Array(renderN);
        upscaledAccelAbs = new Float32Array(renderN);
      }

      // Source coarse buffer for the heatmap channel.
      const coarseHeatmapSource =
        chIdx === CHANNEL_TOTAL ? coarseTotal
        : chIdx === CHANNEL_VEL ? coarseVel
        :                         coarseAccel;

      const needsRender =
        needsSolve ||
        channel !== lastRenderedChannel ||
        contourMode !== lastRenderedContourMode ||
        renderW !== lastRenderW ||
        renderH !== lastRenderH ||
        cachedHeatmapImageData === null ||
        (wantContours && cachedChains.size === 0);

      if (needsRender) {
        // ── Build the heatmap channel's upscaled buffer ─────────────────────────
        if (wantHeatmap) {
          smoothScalars(coarseHeatmapSource, smoothedScalarsBuffer, gridW, gridH);
          let src: Float32Array = smoothedScalarsBuffer;
          for (let p = 1; p < SMOOTH_PASSES_SIGNED; p++) {
            const dst = src === smoothedScalarsBuffer ? smoothPingBuffer : smoothedScalarsBuffer;
            smoothScalars(src, dst, gridW, gridH);
            src = dst;
          }
          bilinearUpsample(src, gridW, gridH, upscaledHeatmap, renderW, renderH);
        }

        // ── Build the bZAccel upscaled buffer (for contours) ────────────────────
        // Skip duplicated work when the heatmap channel is already accel.
        if (wantContours) {
          if (wantHeatmap && chIdx === CHANNEL_ACCEL) {
            upscaledAccel.set(upscaledHeatmap);
          } else {
            smoothScalars(coarseAccel, smoothedScalarsBuffer, gridW, gridH);
            let src: Float32Array = smoothedScalarsBuffer;
            for (let p = 1; p < SMOOTH_PASSES_SIGNED; p++) {
              const dst = src === smoothedScalarsBuffer ? smoothPingBuffer : smoothedScalarsBuffer;
              smoothScalars(src, dst, gridW, gridH);
              src = dst;
            }
            bilinearUpsample(src, gridW, gridH, upscaledAccel, renderW, renderH);
          }

          // Abs buffer for moving_charge envelope-contour threshold detection.
          if (contourMode === 'envelope') {
            for (let k = 0; k < renderN; k++) upscaledAccelAbs[k] = Math.abs(upscaledAccel[k]);
            cachedContourAbsPeak = computeContrastPeak(upscaledAccelAbs, 'envelope');
          } else {
            cachedContourAbsPeak = 0; // zero-crossing contour needs no peak
          }
        }

        // Heatmap image data. Use the policy-governed per-channel peak so the
        // rendering is stable in periodic modes and responsive in transient ones.
        if (wantHeatmap) {
          cachedHeatmapImageData = buildHeatmapImageData(
            upscaledHeatmap, renderW, renderH, 'signed', renderWorkspace, heatmapPeak,
          );
          cachedHeatmapPeak = heatmapPeak;
        } else {
          cachedHeatmapImageData = null;
          cachedHeatmapPeak = 0;
        }
        cachedAccelPeak = accelPeak;

        cachedChains.clear();
        lastRenderedChannel     = channel;
        lastRenderedContourMode = contourMode;
        lastRenderW             = renderW;
        lastRenderH             = renderH;
      }

      if (wantHeatmap && cachedHeatmapImageData) {
        drawHeatmap(ctx, cachedHeatmapImageData, renderW, renderH, cssW, cssH, renderWorkspace, 0.6);
      }

      if (wantContours) {
        // Contour buffer and peak are mode-dependent — always derived from bZAccel:
        //   oscillating / dipole / hydrogen → upscaledAccel + zero-crossing (no peak needed)
        //   moving_charge                   → upscaledAccelAbs + envelope threshold
        const contourBuffer = contourMode === 'signed' ? upscaledAccel : upscaledAccelAbs;
        const levels = getDefaultContourLevels(contourMode, contourBuffer, cachedContourAbsPeak || cachedAccelPeak);

        const toScreenX = (rx: number) => (rx / Math.max(renderW - 1, 1)) * cssW;
        const toScreenY = (ry: number) => (ry / Math.max(renderH - 1, 1)) * cssH;

        const getChains = (isoValue: number): number[][] => {
          let chains = cachedChains.get(isoValue);
          if (!chains) {
            chains = chainContourSegments(
              extractContourSegments(contourBuffer, renderW, renderH, isoValue),
            );
            cachedChains.set(isoValue, chains);
          }
          return chains;
        };

        ctx.save();
        ctx.lineWidth = CONTOUR_LINE_WIDTH;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const [threshold] = levels;
        ctx.strokeStyle = CONTOUR_PHASE; // near-white for both modes, matches GPU path
        strokeChains(ctx, getChains(threshold), toScreenX, toScreenY);

        ctx.restore();
      }

      // Suppress unused-var lint on cachedHeatmapPeak (kept for telemetry/debugging parity).
      void cachedHeatmapPeak;
    }

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  // isPausedRef and simEpochRef are read via refs inside the RAF closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeRuntimesRef, simulationTimeRef, configRef, simEpochRef]);

  return <canvas ref={canvasRef} style={style} />;
}

// WavefrontOverlayCanvas — overlay canvas that renders the M6 radiation heatmap
// and wavefront contours.
//
// Owns a DOM canvas, ResizeObserver, and RAF loop. Physics sampling is done via
// wavefrontSampler; pixel rendering via wavefrontRender. Always returns signed
// bZAccel from the sampler — mode-specific shaping (abs for envelope) happens here.
//
// Grid sizing: world-space driven — one sample per TARGET_WORLD_CELL_FACTOR * c
// world units. Cap at MAX_GRID_CELLS total, scale both axes proportionally.
// This keeps sampling fidelity stable across zoom levels.
//
// Stacking: position:absolute inset:0, zIndex:10 (below VectorFieldCanvas at z-15).

import { useEffect, useRef, type CSSProperties, type RefObject, type MutableRefObject } from 'react';
import type { SimConfig } from '@/physics/types';
import type { ChargeHistory } from '@/physics/chargeHistory';
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

// Smoothing passes per mode. 1 is the correct starting point for both.
// Increase SMOOTH_PASSES_ENVELOPE to 2 only if manual visual review warrants it.
const SMOOTH_PASSES_SIGNED   = 1;
const SMOOTH_PASSES_ENVELOPE = 1;

type Props = {
  historyRef: RefObject<ChargeHistory>;
  simulationTimeRef: MutableRefObject<number>;
  chargeRef: MutableRefObject<number>;
  configRef: MutableRefObject<SimConfig>;
  simEpochRef: MutableRefObject<number>;
  bounds: WorldBounds;
  demoMode: 'moving_charge' | 'oscillating';
  showHeatmap: boolean;
  showContours: boolean;
  isPausedRef: MutableRefObject<boolean>;
  style?: CSSProperties;
};

// Contour stroke color: near-white for both modes, matching the GPU shader path.
const CONTOUR_PHASE    = 'rgba(220, 220, 220, 0.85)';
const CONTOUR_LINE_WIDTH = 1.5;

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
  historyRef,
  simulationTimeRef,
  chargeRef,
  configRef,
  simEpochRef,
  bounds,
  demoMode,
  showHeatmap,
  showContours,
  isPausedRef,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mirror props into refs so the RAF closure always reads current values
  // without needing to restart the effect when props change.
  const boundsRef    = useRef(bounds);
  const demoModeRef  = useRef(demoMode);
  const showHeatmapRef  = useRef(showHeatmap);
  const showContoursRef = useRef(showContours);
  useEffect(() => { boundsRef.current       = bounds;       }, [bounds]);
  useEffect(() => { demoModeRef.current     = demoMode;     }, [demoMode]);
  useEffect(() => { showHeatmapRef.current  = showHeatmap;  }, [showHeatmap]);
  useEffect(() => { showContoursRef.current = showContours; }, [showContours]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Persistent physics + render state held in closed-over locals (not React state).
    const samplerState: WavefrontSamplerState = createSamplerState();
    const renderWorkspace: WavefrontRenderWorkspace = createRenderWorkspace();

    // Last-rendered scalar buffer — reused when paused so we don't re-solve every frame.
    let cachedScalars: Float32Array | null = null;
    // Reused buffer for the smoothed signed scalars (coarse grid). Resized when grid changes.
    let smoothedScalarsBuffer: Float32Array = new Float32Array(0);
    // Ping-pong buffer for multi-pass smoothing (unused until passes > 1).
    let smoothPingBuffer: Float32Array = new Float32Array(0);
    // Bilinearly upscaled signed field (renderW × renderH).
    let upscaledSignedBuffer: Float32Array = new Float32Array(0);
    // Abs-mapped upscaled field — used for moving_charge contour threshold detection.
    let upscaledDisplayBuffer: Float32Array = new Float32Array(0);
    // Derived-render cache — reused across frames when physics, mode, and render dims are unchanged.
    let cachedHeatmapImageData: ImageData | null = null;
    let cachedContrastPeak = 0;
    // Peak of the abs buffer — used for moving_charge contour level computation.
    let cachedContourPeak = 0;
    let lastRenderedMode = '';
    let lastRenderW = -1;
    let lastRenderH = -1;
    // Chain cache: iso-value (number) → chained polylines. Cleared on every re-render.
    const cachedChains: Map<number, number[][]> = new Map();
    let lastSolvedSimTime = NaN;
    let lastSolvedEpoch = -1;
    let lastSolvedMinX = NaN;
    let lastSolvedMaxX = NaN;
    let lastSolvedMinY = NaN;
    let lastSolvedMaxY = NaN;
    let lastSolvedC = NaN;
    let lastGridW = -1;
    let lastGridH = -1;

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

      const wantHeatmap  = showHeatmapRef.current;
      const wantContours = showContoursRef.current;
      if (!wantHeatmap && !wantContours) return;

      const currentBounds  = boundsRef.current;

      // Grid dimensions: world-space driven so fidelity is stable across zoom levels.
      // Target one sample per (TARGET_WORLD_CELL_FACTOR * c) world units.
      // If the resulting total exceeds MAX_GRID_CELLS, scale both axes down proportionally.
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
      // Falls back to smaller scale if the render budget is exceeded.
      const renderDim = (n: number, s: number) => (n - 1) * s + 1;
      let renderScale = RENDER_SCALE;
      if (renderDim(gridW, renderScale) * renderDim(gridH, renderScale) > MAX_RENDER_CELLS) renderScale = 2;
      if (renderDim(gridW, renderScale) * renderDim(gridH, renderScale) > MAX_RENDER_CELLS) renderScale = 1;
      const renderW = renderDim(gridW, renderScale);
      const renderH = renderDim(gridH, renderScale);

      // Heatmap always uses signed coloring (warm/cool dual-hue) for both modes.
      // Contour logic is independent: oscillating uses zero-crossing on the signed field;
      // moving_charge uses an envelope threshold on the abs field.
      const mode: HeatmapMode = 'signed';
      const contourMode: HeatmapMode = demoModeRef.current === 'oscillating' ? 'signed' : 'envelope';

      const currentSimTime = simulationTimeRef.current;
      const currentEpoch   = simEpochRef.current;
      const paused = isPausedRef.current;

      const needsSolve =
        !paused ||
        cachedScalars === null ||
        currentSimTime !== lastSolvedSimTime ||
        currentEpoch   !== lastSolvedEpoch   ||
        currentBounds.minX !== lastSolvedMinX ||
        currentBounds.maxX !== lastSolvedMaxX ||
        currentBounds.minY !== lastSolvedMinY ||
        currentBounds.maxY !== lastSolvedMaxY ||
        configRef.current.c !== lastSolvedC    ||
        gridW !== lastGridW ||
        gridH !== lastGridH;

      let scalars: Float32Array;

      if (needsSolve) {
        scalars = sampleWavefront(samplerState, {
          history:   historyRef.current,
          simTime:   currentSimTime,
          charge:    chargeRef.current,
          config:    configRef.current,
          bounds:    {
            minX: currentBounds.minX,
            maxX: currentBounds.maxX,
            minY: currentBounds.minY,
            maxY: currentBounds.maxY,
          },
          gridW,
          gridH,
          simEpoch: currentEpoch,
        });
        cachedScalars = scalars;
        lastSolvedSimTime = currentSimTime;
        lastSolvedEpoch   = currentEpoch;
        lastSolvedMinX    = currentBounds.minX;
        lastSolvedMaxX    = currentBounds.maxX;
        lastSolvedMinY    = currentBounds.minY;
        lastSolvedMaxY    = currentBounds.maxY;
        lastSolvedC       = configRef.current.c;
        lastGridW         = gridW;
        lastGridH         = gridH;
      } else {
        scalars = cachedScalars!;
      }

      // Resize coarse-grid buffers when dimensions change.
      if (smoothedScalarsBuffer.length !== gridW * gridH) {
        smoothedScalarsBuffer = new Float32Array(gridW * gridH);
        smoothPingBuffer      = new Float32Array(gridW * gridH);
      }
      // Resize render-lattice buffers when dimensions change.
      const renderN = renderW * renderH;
      if (upscaledSignedBuffer.length !== renderN) {
        upscaledSignedBuffer  = new Float32Array(renderN);
        upscaledDisplayBuffer = new Float32Array(renderN);
      }

      // needsRender is true whenever the underlying coarse field changed, the mode
      // changed, the render-lattice dimensions changed, or a derived render artifact
      // is missing and must be lazily rebuilt after an overlay toggle while paused.
      const needsRender =
        needsSolve ||
        contourMode !== lastRenderedMode ||
        renderW !== lastRenderW ||
        renderH !== lastRenderH ||
        cachedHeatmapImageData === null ||
        (wantContours && cachedChains.size === 0);

      if (needsRender) {
        // ── Stage 1: smooth the signed coarse field ────────────────────────────
        smoothScalars(scalars, smoothedScalarsBuffer, gridW, gridH);
        let smoothedSigned: Float32Array = smoothedScalarsBuffer;
        for (let p = 1; p < SMOOTH_PASSES_SIGNED; p++) {
          const dst = smoothedSigned === smoothedScalarsBuffer ? smoothPingBuffer : smoothedScalarsBuffer;
          smoothScalars(smoothedSigned, dst, gridW, gridH);
          smoothedSigned = dst;
        }

        // ── Stage 2: bilinear upsample into render lattice (signed) ───────────
        bilinearUpsample(smoothedSigned, gridW, gridH, upscaledSignedBuffer, renderW, renderH);

        // ── Stage 3: fill abs buffer for moving_charge contour threshold ───────
        // abs() after scalar-space upscaling ensures zero crossings interpolate
        // toward zero rather than blending between warm and cool colors.
        // The heatmap always uses the signed buffer; abs is only for contour detection.
        if (contourMode === 'envelope') {
          for (let k = 0; k < renderN; k++) {
            upscaledDisplayBuffer[k] = Math.abs(upscaledSignedBuffer[k]);
          }
          cachedContourPeak = computeContrastPeak(upscaledDisplayBuffer, 'envelope');
        } else {
          cachedContourPeak = 0; // unused for oscillating (zero-crossing needs no peak)
        }

        // ── Stage 4: heatmap contrast peak (signed) ────────────────────────────
        cachedContrastPeak = computeContrastPeak(upscaledSignedBuffer, 'signed');

        // ── Stage 5: build heatmap ImageData — always signed dual-hue ──────────
        cachedHeatmapImageData = buildHeatmapImageData(
          upscaledSignedBuffer, renderW, renderH, 'signed', renderWorkspace, cachedContrastPeak,
        );

        cachedChains.clear();
        lastRenderedMode = contourMode;
        lastRenderW      = renderW;
        lastRenderH      = renderH;
      }

      // Heatmap always draws the signed buffer.
      const displayBuffer = upscaledSignedBuffer;

      if (wantHeatmap && cachedHeatmapImageData) {
        drawHeatmap(ctx, cachedHeatmapImageData, renderW, renderH, cssW, cssH, renderWorkspace, 0.6);
      }

      if (wantContours) {
        // Contour buffer and peak are mode-dependent:
        // oscillating → signed buffer + zero-crossing (no peak needed)
        // moving_charge → abs buffer + envelope threshold (0.20 × abs peak)
        const contourBuffer = contourMode === 'signed' ? upscaledSignedBuffer : upscaledDisplayBuffer;
        const levels = getDefaultContourLevels(contourMode, contourBuffer, cachedContourPeak || cachedContrastPeak);

        // Map fractional render-lattice coords to canvas pixel coords.
        const toScreenX = (rx: number) => (rx / Math.max(renderW - 1, 1)) * cssW;
        const toScreenY = (ry: number) => (ry / Math.max(renderH - 1, 1)) * cssH;

        // Lazily chain segments for each iso-value; cached until next needsRender.
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
    }

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  // isPausedRef and simEpochRef are read via refs inside the RAF closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRef, simulationTimeRef, chargeRef, configRef, simEpochRef]);

  return <canvas ref={canvasRef} style={style} />;
}

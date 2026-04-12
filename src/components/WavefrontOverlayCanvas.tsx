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
  getDefaultContourLevels,
  type WavefrontRenderWorkspace,
} from '@/rendering/wavefrontRender';

// World-space grid sizing constants.
// One sample every (TARGET_WORLD_CELL_FACTOR * c) world units keeps fidelity
// proportional to the physical wavelength/shell-width regardless of zoom.
const TARGET_WORLD_CELL_FACTOR = 0.20;
const MAX_GRID_CELLS = 16384;

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

// Contour stroke colors.
// Phase boundary (signed / oscillating): neutral so it reads as a zero-crossing,
// not as belonging to either the warm or cool lobe.
const CONTOUR_PHASE    = 'rgba(220, 220, 220, 0.85)';
// Pulse boundary (envelope / moving_charge): warm to match the heatmap palette.
const CONTOUR_ENVELOPE = 'rgba(255, 140, 30, 0.85)';
const CONTOUR_LINE_WIDTH = 1.5;

/**
 * Draw chained polylines using midpoint quadratic Bézier smoothing.
 * Each polyline is a flat [x0, y0, x1, y1, ...] array in fractional grid coords.
 * Control point = joint vertex; curve passes through midpoints between joints.
 * This rounds corners cosmetically without altering the path topology.
 * Closed loops (first point == last point) get a smooth closePath.
 */
function strokeChains(
  ctx: CanvasRenderingContext2D,
  chains: number[][],
  toScreenX: (x: number) => number,
  toScreenY: (y: number) => number,
): void {
  ctx.beginPath();
  for (const pts of chains) {
    const nv = pts.length >> 1; // number of vertices
    if (nv < 2) continue;

    const sx = (k: number) => toScreenX(pts[k * 2]);
    const sy = (k: number) => toScreenY(pts[k * 2 + 1]);

    const closed =
      pts[0] === pts[(nv - 1) * 2] &&
      pts[1] === pts[(nv - 1) * 2 + 1];
    const count = closed ? nv - 1 : nv; // skip duplicated closing vertex
    if (count < 2) continue;

    if (count === 2) {
      // Degenerate single-segment chain — straight line.
      ctx.moveTo(sx(0), sy(0));
      ctx.lineTo(sx(1), sy(1));
      continue;
    }

    // Start at midpoint of first edge.
    ctx.moveTo((sx(0) + sx(1)) / 2, (sy(0) + sy(1)) / 2);

    for (let i = 1; i < count - 1; i++) {
      ctx.quadraticCurveTo(
        sx(i), sy(i),
        (sx(i) + sx(i + 1)) / 2,
        (sy(i) + sy(i + 1)) / 2,
      );
    }

    if (closed) {
      // Smooth close: control = last interior vertex, end = midpoint back to start.
      ctx.quadraticCurveTo(
        sx(count - 1), sy(count - 1),
        (sx(count - 1) + sx(0)) / 2,
        (sy(count - 1) + sy(0)) / 2,
      );
      ctx.closePath();
    } else {
      // Open end: final quadratic degenerates to a line to the last vertex.
      ctx.quadraticCurveTo(
        sx(count - 1), sy(count - 1),
        sx(count - 1), sy(count - 1),
      );
    }
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
    // Reused buffer for the 5-point smoothed signed scalars. Resized only when grid changes.
    let smoothedScalarsBuffer: Float32Array = new Float32Array(0);
    // Reused buffer for abs-mapped scalars (envelope mode). Resized only when grid changes.
    let absScalarsBuffer: Float32Array = new Float32Array(0);
    // Chain cache: iso-value (number) → chained polylines. Cleared on every re-solve.
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
        cachedChains.clear(); // invalidate chain cache whenever scalar data changes
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

      const mode = demoModeRef.current === 'oscillating' ? 'signed' : 'envelope';

      // ── Scalar smoothing (signed, before abs) ────────────────────────────────
      // One 5-point stencil pass on the signed buffer improves contour geometry.
      // Must run before abs() so sign-cancellation structure at phase boundaries
      // is preserved.
      if (smoothedScalarsBuffer.length !== scalars.length) {
        smoothedScalarsBuffer = new Float32Array(scalars.length);
      }
      smoothScalars(scalars, smoothedScalarsBuffer, gridW, gridH);

      // ── Display buffer (abs for envelope, signed-smooth for signed) ──────────
      let displayScalars: Float32Array;
      if (mode === 'envelope') {
        if (absScalarsBuffer.length !== smoothedScalarsBuffer.length) {
          absScalarsBuffer = new Float32Array(smoothedScalarsBuffer.length);
        }
        for (let k = 0; k < smoothedScalarsBuffer.length; k++) {
          absScalarsBuffer[k] = Math.abs(smoothedScalarsBuffer[k]);
        }
        displayScalars = absScalarsBuffer;
      } else {
        displayScalars = smoothedScalarsBuffer;
      }

      if (wantHeatmap) {
        const imageData = buildHeatmapImageData(displayScalars, gridW, gridH, mode, renderWorkspace);
        drawHeatmap(ctx, imageData, gridW, gridH, cssW, cssH, renderWorkspace, 0.6);
      }

      if (wantContours) {
        const levels = getDefaultContourLevels(mode, displayScalars);

        // Map fractional grid coords to canvas pixel coords.
        const toScreenX = (gx: number) => (gx / Math.max(gridW - 1, 1)) * cssW;
        const toScreenY = (gy: number) => (gy / Math.max(gridH - 1, 1)) * cssH;

        // Lazily chain segments for each iso-value; cached until next re-solve.
        const getChains = (isoValue: number): number[][] => {
          let chains = cachedChains.get(isoValue);
          if (!chains) {
            chains = chainContourSegments(
              extractContourSegments(displayScalars, gridW, gridH, isoValue),
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
        ctx.strokeStyle = mode === 'signed' ? CONTOUR_PHASE : CONTOUR_ENVELOPE;
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

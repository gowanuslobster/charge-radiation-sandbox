// WavefrontOverlayCanvas — overlay canvas that renders the M6 radiation heatmap
// and wavefront contours.
//
// Owns a DOM canvas, ResizeObserver, and RAF loop. Physics sampling is done via
// wavefrontSampler; pixel rendering via wavefrontRender. Always returns signed
// bZAccel from the sampler — mode-specific shaping (abs for envelope) happens here.
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
  getDefaultContourLevels,
  type WavefrontRenderWorkspace,
} from '@/rendering/wavefrontRender';

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

// Stroke colors for signed-mode contour lines.
const CONTOUR_WARM = 'rgba(255, 140, 30, 0.85)';
const CONTOUR_COOL = 'rgba(80, 100, 255, 0.85)';
const CONTOUR_ENVELOPE = 'rgba(255, 140, 30, 0.85)';
const CONTOUR_LINE_WIDTH = 1.5;

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
    // Reused buffer for abs-mapped scalars (envelope mode). Resized only when grid changes.
    let absScalarsBuffer: Float32Array = new Float32Array(0);
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

      // Grid dimensions: ~10px per cell, clamped to avoid excessive solves.
      const gridW = Math.max(1, Math.min(96, Math.round(cssW / 10)));
      const gridH = Math.max(1, Math.min(54, Math.round(cssH / 10)));

      const currentBounds  = boundsRef.current;
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

      const mode = demoModeRef.current === 'oscillating' ? 'signed' : 'envelope';

      // For envelope mode, fill the reused abs buffer in place — no per-frame allocation.
      let displayScalars: Float32Array;
      if (mode === 'envelope') {
        if (absScalarsBuffer.length !== scalars.length) {
          absScalarsBuffer = new Float32Array(scalars.length);
        }
        for (let k = 0; k < scalars.length; k++) {
          absScalarsBuffer[k] = Math.abs(scalars[k]);
        }
        displayScalars = absScalarsBuffer;
      } else {
        displayScalars = scalars;
      }

      if (wantHeatmap) {
        const imageData = buildHeatmapImageData(displayScalars, gridW, gridH, mode, renderWorkspace);
        drawHeatmap(ctx, imageData, gridW, gridH, cssW, cssH, renderWorkspace, 0.6);
      }

      if (wantContours) {
        const levels = getDefaultContourLevels(mode, displayScalars);

        // Map fractional grid coords to canvas pixel coords.
        // Grid cell (i=0, j=0) is at canvas (0, 0) in the top-left;
        // cell (i=gridW-1, j=gridH-1) is at (cssW, cssH).
        const toScreenX = (gx: number) => (gx / Math.max(gridW - 1, 1)) * cssW;
        const toScreenY = (gy: number) => (gy / Math.max(gridH - 1, 1)) * cssH;

        ctx.save();
        ctx.lineWidth = CONTOUR_LINE_WIDTH;
        ctx.lineCap = 'round';

        if (mode === 'signed') {
          // Two levels: positive (warm) and negative (cool).
          const [posThreshold, negThreshold] = levels;

          const posSegs = extractContourSegments(displayScalars, gridW, gridH, posThreshold);
          ctx.strokeStyle = CONTOUR_WARM;
          ctx.beginPath();
          for (const s of posSegs) {
            ctx.moveTo(toScreenX(s.x1), toScreenY(s.y1));
            ctx.lineTo(toScreenX(s.x2), toScreenY(s.y2));
          }
          ctx.stroke();

          const negSegs = extractContourSegments(displayScalars, gridW, gridH, negThreshold);
          ctx.strokeStyle = CONTOUR_COOL;
          ctx.beginPath();
          for (const s of negSegs) {
            ctx.moveTo(toScreenX(s.x1), toScreenY(s.y1));
            ctx.lineTo(toScreenX(s.x2), toScreenY(s.y2));
          }
          ctx.stroke();
        } else {
          // One level for envelope mode.
          const [threshold] = levels;
          const segs = extractContourSegments(displayScalars, gridW, gridH, threshold);
          ctx.strokeStyle = CONTOUR_ENVELOPE;
          ctx.beginPath();
          for (const s of segs) {
            ctx.moveTo(toScreenX(s.x1), toScreenY(s.y1));
            ctx.lineTo(toScreenX(s.x2), toScreenY(s.y2));
          }
          ctx.stroke();
        }

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

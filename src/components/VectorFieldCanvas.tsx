// VectorFieldCanvas — canvas component that renders the LW vector field.
//
// Owns its DOM canvas element, a ResizeObserver for DPR-aware sizing, and a
// continuous RAF loop. Does NOT own simulation time, history, or camera state.
//
// Refs are read directly on every frame — no parent-to-canvas signaling is needed.
// When React props (bounds, fieldLayer, isPanning) change, the component re-renders
// and the next RAF tick picks up the new values via boundsRef / fieldLayerRef.

import { useEffect, useRef, type CSSProperties, type RefObject, type MutableRefObject } from 'react';
import type { SimConfig, Vec2 } from '@/physics/types';
import type { ChargeRuntime } from '@/physics/chargeRuntime';
import { evaluateSuperposedLienardWiechertField } from '@/physics/lienardWiechert';
import { getWorldToScreenTransform, transformWorldPoint, type WorldBounds } from '@/rendering/worldSpace';
import { fillArrowSpec, type ArrowSpec } from '@/rendering/arrows';
import { CHARGE_MARKER_RADIUS_PX } from '@/rendering/chargeMarker';

type Props = {
  chargeRuntimesRef: RefObject<ChargeRuntime[]>;
  simulationTimeRef: RefObject<number>;
  configRef: RefObject<SimConfig>;
  bounds: WorldBounds;
  gridW?: number; // default 40
  gridH?: number; // default 40
  fieldLayer: 'total' | 'vel' | 'accel';
  /** True while the user is panning — halves grid density for responsiveness. */
  isPanning?: boolean;
  isPausedRef?: RefObject<boolean>;
  /** Incremented by ChargeRadiationSandbox on every reseed; forces a re-solve even when paused. */
  simEpochRef?: RefObject<number>;
  /**
   * World-space position of the ghost charge (extrapolated would-have-been position).
   * Null = no ghost drawn. Written by ChargeRadiationSandbox; read here for rendering only.
   */
  ghostPosRef?: RefObject<Vec2 | null>;
  /**
   * Optional external MutableRefObject to receive the canvas element.
   * Used by useCursorReadout to attach canvas-scoped pointer listeners.
   */
  externalCanvasRef?: MutableRefObject<HTMLCanvasElement | null>;
  /** Forwarded to the canvas element. Caller uses position:absolute inset:0. */
  style?: CSSProperties;
};

// Shared wing-endpoint computation: rotate backward direction by ±wingAngle.
// Returns [w1x, w1y, w2x, w2y].
function wingPoints(spec: ArrowSpec): [number, number, number, number] {
  const { x0, y0, x1, y1, headX, headY, wingAngle, headLength } = spec;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;
  const cos = Math.cos(wingAngle);
  const sin = Math.sin(wingAngle);
  return [
    headX + headLength * (-ux * cos + uy * sin),
    headY + headLength * (-ux * sin - uy * cos),
    headX + headLength * (-ux * cos - uy * sin),
    headY + headLength * (ux * sin - uy * cos),
  ];
}

// Pass 1: crisp core arrow — stem stroke + filled triangle arrowhead. No shadow.
function drawArrowCore(ctx: CanvasRenderingContext2D, spec: ArrowSpec): void {
  const { x0, y0, x1, y1, headX, headY, lineWidth, alpha, color } = spec;

  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.sqrt(dx * dx + dy * dy) < 1) return;

  const rgb = `rgb(${color.r},${color.g},${color.b})`;
  ctx.strokeStyle = rgb;
  ctx.fillStyle = rgb;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineWidth;

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  const [w1x, w1y, w2x, w2y] = wingPoints(spec);
  ctx.beginPath();
  ctx.moveTo(headX, headY);
  ctx.lineTo(w1x, w1y);
  ctx.lineTo(w2x, w2y);
  ctx.closePath();
  ctx.fill();
}

// Pass 2 (glow): draw the wider glow shape without any shadow.
// The caller composites this onto the main canvas with a CSS blur filter,
// so one Gaussian blur covers all glow arrows instead of one per arrow.
function drawArrowGlowShape(ctx: CanvasRenderingContext2D, spec: ArrowSpec): void {
  const { x0, y0, x1, y1, headX, headY, lineWidth, glowAlpha, color } = spec;

  const rgb = `rgb(${color.r},${color.g},${color.b})`;
  ctx.strokeStyle = rgb;
  ctx.fillStyle = rgb;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = glowAlpha;
  ctx.lineWidth = lineWidth + 2;

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  const [w1x, w1y, w2x, w2y] = wingPoints(spec);
  ctx.beginPath();
  ctx.moveTo(headX, headY);
  ctx.lineTo(w1x, w1y);
  ctx.lineTo(w2x, w2y);
  ctx.closePath();
  ctx.fill();
}

export function VectorFieldCanvas({
  chargeRuntimesRef,
  simulationTimeRef,
  configRef,
  bounds,
  gridW = 40,
  gridH = 40,
  fieldLayer,
  isPanning = false,
  isPausedRef,
  simEpochRef,
  ghostPosRef,
  externalCanvasRef,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mirror props into refs so the RAF closure always reads current values
  // without needing to restart the effect when props change.
  const boundsRef = useRef(bounds);
  const fieldLayerRef = useRef(fieldLayer);
  const isPanningRef = useRef(isPanning);
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);
  useEffect(() => { fieldLayerRef.current = fieldLayer; }, [fieldLayer]);
  useEffect(() => { isPanningRef.current = isPanning; }, [isPanning]);

  // Main RAF loop. Restarts only if grid dimensions change (rare).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;

    // Off-DOM canvas for the glow pass. Glow shapes are drawn here (no shadowBlur),
    // then composited onto the main canvas with ctx.filter = 'blur(8px)' — one
    // Gaussian blur per frame instead of one per arrow.
    const glowCanvas = document.createElement('canvas');
    const glowCtx = glowCanvas.getContext('2d')!;

    // Pre-allocate object pool for the 40×40 grid loop (AGENTS.md §123: avoid inner-loop
    // allocation). Each slot owns its RGB so fillArrowSpec can mutate color in place.
    // Pool is sized gridW*gridH; only the first arrowCount slots are valid each frame.
    const arrowPool: ArrowSpec[] = Array.from({ length: gridW * gridH }, () => ({
      x0: 0, y0: 0, x1: 0, y1: 0,
      headX: 0, headY: 0,
      wingAngle: 0, headLength: 0,
      lineWidth: 0, alpha: 0,
      color: { r: 0, g: 0, b: 0 },
      glowBlur: 0, glowAlpha: 0,
    }));
    // Scratch observation-position object: mutated per grid point, never reallocated.
    const obsPos = { x: 0, y: 0 };

    // Cached arrow count from the last solve. When paused, we skip the solve and
    // redraw the existing pool contents. Initialised to -1 so the first frame always solves.
    let cachedArrowCount = -1;
    // Snapshot of every input to evaluateLienardWiechertField / fillArrowSpec.
    // The cache is valid iff all of these match. Any change forces a re-solve —
    // this is the complete list; adding a new physics input here is enough to make
    // the pause-skip safe for that input too.
    //   simTime  — covers running playback AND step-forward
    //   epoch    — covers reseeds where simTime stays 0 (e.g. mode switch at t=0)
    //   bounds   — covers pan and zoom
    //   layer    — covers field-layer toggle while paused
    //   c        — covers c-slider adjustment while paused (retarded time shifts)
    let lastSolvedSimTime = NaN;
    let lastSolvedEpoch = -1;
    let lastSolvedMinX = NaN;
    let lastSolvedMaxX = NaN;
    let lastSolvedMinY = NaN;
    let lastSolvedMaxY = NaN;
    let lastSolvedLayer = '';
    let lastSolvedC = NaN;
    let lastChargeCount = -1;

    // DPR-aware sizing via ResizeObserver.
    // Setting canvas.width/height resets the ctx transform, so we re-apply DPR scale here.
    // Re-check canvas/ctx inside the callback: TypeScript does not carry null-narrowing
    // through closure boundaries, even for const variables.
    const ro = new ResizeObserver(() => {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.scale(dpr, dpr);
      // Glow canvas lives in CSS pixel space (no DPR scale) — it is drawn
      // into the DPR-scaled main ctx via drawImage, which handles the upscale.
      glowCanvas.width = cssW;
      glowCanvas.height = cssH;
    });
    ro.observe(canvas);

    function frame() {
      rafId = requestAnimationFrame(frame);
      if (!canvas || !ctx) return; // re-check: TypeScript closure narrowing limitation

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;

      // When paused and the pool is already populated, skip the LW solve and
      // redraw the cached arrows. The charge marker still redraws so the canvas
      // doesn't go blank, but avoids 1600 unnecessary solves per frame.
      // Exception: always re-solve when simEpoch changes (reseed after mode switch
      // or auto-reseed), even while paused, so the field never shows stale arrows.
      const paused = isPausedRef?.current ?? false;
      const currentSimTime = simulationTimeRef.current;
      const currentEpoch = simEpochRef?.current ?? 0;
      const currentBounds = boundsRef.current;
      const layer = fieldLayerRef.current;
      const needsSolve =
        !paused ||
        cachedArrowCount < 0 ||
        currentSimTime !== lastSolvedSimTime ||
        currentEpoch !== lastSolvedEpoch ||
        currentBounds.minX !== lastSolvedMinX ||
        currentBounds.maxX !== lastSolvedMaxX ||
        currentBounds.minY !== lastSolvedMinY ||
        currentBounds.maxY !== lastSolvedMaxY ||
        layer !== lastSolvedLayer ||
        configRef.current.c !== lastSolvedC ||
        chargeRuntimesRef.current.length !== lastChargeCount;

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      const transform = getWorldToScreenTransform(currentBounds, cssW, cssH);

      // During active pan, halve the grid to cut solve count by 75%.
      const activeGridW = isPanningRef.current ? Math.ceil(gridW / 2) : gridW;
      const activeGridH = isPanningRef.current ? Math.ceil(gridH / 2) : gridH;

      // Arrow length cap: grid cell size × 0.45 prevents arrows exceeding their cell
      // when zoomed in. field-sandbox avoids this with fixed screen-space spacing;
      // we use a world-space grid so the cap is computed per frame from canvas size.
      const gridSpacingPx = Math.min(cssW / activeGridW, cssH / activeGridH);
      const maxLengthPx = gridSpacingPx * 0.45;

      if (needsSolve) {
        const spanX = currentBounds.maxX - currentBounds.minX;
        const spanY = currentBounds.maxY - currentBounds.minY;
        const chargeRuntimes = chargeRuntimesRef.current;
        const simTime = simulationTimeRef.current;
        const config = configRef.current;

        // Evaluate superposed LW field at each grid point and fill the pre-allocated pool.
        // obsPos is mutated in place — no per-grid-point allocation.
        // transformWorldPoint is inlined to avoid a Vec2 allocation per point.
        let arrowCount = 0;
        for (let j = 0; j < activeGridH; j++) {
          for (let i = 0; i < activeGridW; i++) {
            obsPos.x = currentBounds.minX + (i + 0.5) * spanX / activeGridW;
            obsPos.y = currentBounds.minY + (j + 0.5) * spanY / activeGridH;

            const result = evaluateSuperposedLienardWiechertField({
              observationPos: obsPos,
              observationTime: simTime,
              chargeRuntimes,
              config,
            });
            if (!result) continue;

            const fieldVec =
              layer === 'vel' ? result.eVel :
              layer === 'accel' ? result.eAccel :
              result.eTotal;

            // Inline transformWorldPoint: screenX = a*wx + e, screenY = d*wy + f.
            const cpx = transform.a * obsPos.x + transform.e;
            const cpy = transform.d * obsPos.y + transform.f;

            if (fillArrowSpec(arrowPool[arrowCount], cpx, cpy, fieldVec, transform, maxLengthPx)) {
              arrowCount++;
            }
          }
        }
        cachedArrowCount = arrowCount;
        lastSolvedSimTime = currentSimTime;
        lastSolvedEpoch = currentEpoch;
        lastSolvedMinX = currentBounds.minX;
        lastSolvedMaxX = currentBounds.maxX;
        lastSolvedMinY = currentBounds.minY;
        lastSolvedMaxY = currentBounds.maxY;
        lastSolvedLayer = layer;
        lastSolvedC = configRef.current.c;
        lastChargeCount = chargeRuntimes.length;
      }

      // Two-pass draw: core arrows first (no shadow state), then glow-only pass.
      // Batching shadowBlur changes avoids toggling the GPU compositor per arrow.
      const arrowCount = cachedArrowCount;

      // Pass 1: core (stem + arrowhead, no shadow).
      for (let k = 0; k < arrowCount; k++) {
        drawArrowCore(ctx, arrowPool[k]);
      }

      // Pass 2: glow overlay.
      // Draw glow shapes onto the off-DOM glowCanvas (no shadowBlur), then
      // composite the whole canvas onto the main canvas with a single CSS blur.
      // One Gaussian blur per frame instead of one per qualifying arrow.
      glowCtx.clearRect(0, 0, cssW, cssH);
      for (let k = 0; k < arrowCount; k++) {
        const spec = arrowPool[k];
        if (spec.glowBlur > 0) {
          drawArrowGlowShape(glowCtx, spec);
        }
      }
      ctx.save();
      ctx.filter = 'blur(8px)';
      ctx.globalAlpha = 1;
      ctx.drawImage(glowCanvas, 0, 0);
      ctx.restore();

      // Draw one charge marker per runtime.
      // newest() is null before the first reseed completes (brief window during mount).
      for (const runtime of chargeRuntimesRef.current) {
        const newest = runtime.history.newest();
        if (newest === null) continue;

        const mp = transformWorldPoint(newest.pos, transform);
        const radius = CHARGE_MARKER_RADIUS_PX;
        const isPositive = runtime.charge >= 0;

        ctx.save();

        // Velocity arrow — drawn first so the charge circle renders on top of its base.
        // Only shown for β > 0.005; hidden for stationary charges.
        const vel = newest.vel;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        const beta = speed / configRef.current.c;
        if (beta > 0.005) {
          const MAX_VEL_ARROW_PX = cssW * 0.20;
          const BETA_FLOOR = 0.15;
          const HEAD_LEN = 10;

          const cdx = vel.x * transform.a;
          const cdy = vel.y * transform.d;
          const cMag = Math.sqrt(cdx * cdx + cdy * cdy);
          const nx = cdx / cMag;
          const ny = cdy / cMag;

          const arrowLen = Math.max(beta, BETA_FLOOR) * MAX_VEL_ARROW_PX;
          const stemStartX = mp.x + nx * radius;
          const stemStartY = mp.y + ny * radius;
          const tipX = stemStartX + nx * arrowLen;
          const tipY = stemStartY + ny * arrowLen;

          const w1x = tipX - nx * HEAD_LEN - ny * 5.5;
          const w1y = tipY - ny * HEAD_LEN + nx * 5.5;
          const w2x = tipX - nx * HEAD_LEN + ny * 5.5;
          const w2y = tipY - ny * HEAD_LEN - nx * 5.5;

          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = 1;

          ctx.strokeStyle = 'rgba(159,247,255,0.18)';
          ctx.lineWidth = 5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(stemStartX, stemStartY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(159,247,255,0.85)';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([8, 7]);
          ctx.beginPath();
          ctx.moveTo(stemStartX, stemStartY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          ctx.setLineDash([]);
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(w1x, w1y);
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(w2x, w2y);
          ctx.stroke();

          const label = `${beta.toFixed(2)}c`;
          const labelDist = HEAD_LEN + 10;
          const labelX = tipX + nx * labelDist;
          const labelY = tipY + ny * labelDist;

          ctx.setLineDash([]);
          ctx.font = 'bold 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.85)';
          ctx.shadowBlur = 4;
          ctx.fillStyle = 'rgba(159,247,255,0.95)';
          ctx.fillText(label, labelX, labelY);
          ctx.shadowBlur = 0;
        }

        // Charge circle and sign label — orange for positive, blue for negative.
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isPositive ? '#ff7a3f' : '#4a9eff';
        ctx.fill();
        ctx.strokeStyle = isPositive ? 'rgba(255,200,120,0.8)' : 'rgba(120,180,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = `bold ${radius + 3}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;
        ctx.fillText(isPositive ? '+' : '−', mp.x, mp.y);

        ctx.restore();
      }

      // Ghost charge marker — dashed circle at the extrapolated would-have-been position.
      // Purely visual: not a physics source. Only drawn when ghostPosRef is non-null.
      const ghostPos = ghostPosRef?.current ?? null;
      if (ghostPos !== null) {
        const gp = transformWorldPoint(ghostPos, transform);
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(200,200,200,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, CHARGE_MARKER_RADIUS_PX, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  // isPausedRef and simEpochRef are intentionally read via refs inside the RAF closure
  // rather than listed as deps — adding them would restart the loop on every pause toggle
  // and reseed, which would reset the glow canvas and pool. The ref pattern is the
  // correct idiom for values that must be readable from a long-lived RAF loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeRuntimesRef, simulationTimeRef, configRef, gridW, gridH]);

  return (
    <canvas
      ref={(el) => {
        canvasRef.current = el;
        if (externalCanvasRef) externalCanvasRef.current = el;
      }}
      style={style}
    />
  );
}

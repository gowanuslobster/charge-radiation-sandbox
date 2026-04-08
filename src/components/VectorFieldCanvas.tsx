// VectorFieldCanvas — canvas component that renders the LW vector field.
//
// Owns its DOM canvas element, a ResizeObserver for DPR-aware sizing, and a
// continuous RAF loop. Does NOT own simulation time, history, or camera state.
//
// Refs are read directly on every frame — no parent-to-canvas signaling is needed.
// When React props (bounds, fieldLayer, isPanning) change, the component re-renders
// and the next RAF tick picks up the new values via boundsRef / fieldLayerRef.

import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import type { SimConfig } from '@/physics/types';
import type { ChargeHistory } from '@/physics/chargeHistory';
import { evaluateLienardWiechertField } from '@/physics/lienardWiechert';
import { getWorldToScreenTransform, transformWorldPoint, type WorldBounds } from '@/rendering/worldSpace';
import { fillArrowSpec, type ArrowSpec } from '@/rendering/arrows';
import { CHARGE_MARKER_RADIUS_PX } from '@/rendering/chargeMarker';

type Props = {
  historyRef: RefObject<ChargeHistory>;
  simulationTimeRef: RefObject<number>;
  chargeRef: RefObject<number>;
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
   * World-space x coordinate of an optional wall marker (sudden_stop mode).
   * Null = no wall drawn. The marker is a short vertical line with diagonal ticks.
   */
  wallWorldX?: number | null;
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
  historyRef,
  simulationTimeRef,
  chargeRef,
  configRef,
  bounds,
  gridW = 40,
  gridH = 40,
  fieldLayer,
  isPanning = false,
  isPausedRef,
  simEpochRef,
  wallWorldX = null,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mirror props into refs so the RAF closure always reads current values
  // without needing to restart the effect when props change.
  const boundsRef = useRef(bounds);
  const fieldLayerRef = useRef(fieldLayer);
  const isPanningRef = useRef(isPanning);
  const wallWorldXRef = useRef(wallWorldX);
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);
  useEffect(() => { fieldLayerRef.current = fieldLayer; }, [fieldLayer]);
  useEffect(() => { isPanningRef.current = isPanning; }, [isPanning]);
  useEffect(() => { wallWorldXRef.current = wallWorldX; }, [wallWorldX]);

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
    let lastSolvedSimTime = NaN;
    let lastSolvedEpoch = -1;
    let lastSolvedMinX = NaN;
    let lastSolvedMaxX = NaN;
    let lastSolvedMinY = NaN;
    let lastSolvedMaxY = NaN;
    let lastSolvedLayer = '';

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
        layer !== lastSolvedLayer;

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
        const history = historyRef.current;
        const simTime = simulationTimeRef.current;
        const charge = chargeRef.current;
        const config = configRef.current;

        // Evaluate LW field at each grid point and fill the pre-allocated pool.
        // obsPos is mutated in place — no per-grid-point allocation.
        // transformWorldPoint is inlined to avoid a Vec2 allocation per point.
        let arrowCount = 0;
        for (let j = 0; j < activeGridH; j++) {
          for (let i = 0; i < activeGridW; i++) {
            obsPos.x = currentBounds.minX + (i + 0.5) * spanX / activeGridW;
            obsPos.y = currentBounds.minY + (j + 0.5) * spanY / activeGridH;

            const result = evaluateLienardWiechertField({
              observationPos: obsPos,
              observationTime: simTime,
              history,
              charge,
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

      // Wall marker — drawn after arrows so it appears on top of the field layer,
      // but before the charge marker so the charge renders above the wall.
      // Vertical line + diagonal ticks (standard physics wall symbol).
      const wallX = wallWorldXRef.current;
      if (wallX !== null) {
        const wx = transform.a * wallX + transform.e; // world x → canvas x
        // y=0 in world (the charge's travel axis) → canvas y.
        const wy = transform.d * 0 + transform.f;
        const HALF_H = 80;   // half-height of the vertical bar (px)
        const TICK_LEN = 12; // diagonal tick length (px)
        const TICK_COUNT = 7;

        ctx.save();
        ctx.strokeStyle = 'rgba(255,200,120,0.85)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 1;
        ctx.shadowColor = 'rgba(255,200,120,0.4)';
        ctx.shadowBlur = 6;

        // Vertical bar.
        ctx.beginPath();
        ctx.moveTo(wx, wy - HALF_H);
        ctx.lineTo(wx, wy + HALF_H);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Diagonal ticks extending to the right — classic physics wall hatch.
        for (let i = 0; i <= TICK_COUNT; i++) {
          const ty = wy - HALF_H + (2 * HALF_H) * i / TICK_COUNT;
          ctx.beginPath();
          ctx.moveTo(wx, ty);
          ctx.lineTo(wx + TICK_LEN, ty + TICK_LEN);
          ctx.stroke();
        }

        ctx.restore();
      }

      // Draw source charge marker from newest recorded state.
      // newest() is null before the first reseed completes (brief window during mount).
      const newest = historyRef.current.newest();
      if (newest !== null) {
        const mp = transformWorldPoint(newest.pos, transform);
        const radius = CHARGE_MARKER_RADIUS_PX;

        ctx.save();

        // Velocity arrow — drawn first so the charge circle renders on top of its base.
        // Only shown for β > 0.005; hidden for stationary charges.
        // Arrow length: max(β, 0.15) × (cssW × 0.20) — floors at β=0.15 visual size
        // so slow charges still show a legible arrow. At β=1 the arrow is ~1/5 screen width.
        // Direction is transformed to canvas space (transform.d < 0 applies the Y-flip).
        const vel = newest.vel;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        const beta = speed / configRef.current.c;
        if (beta > 0.005) {
          const MAX_VEL_ARROW_PX = cssW * 0.20;
          const BETA_FLOOR = 0.15; // visual minimum — arrow never smaller than this fraction
          const HEAD_LEN = 10;

          // Unit vector in canvas space: scale world components by transform diagonal.
          const cdx = vel.x * transform.a;
          const cdy = vel.y * transform.d; // d < 0 → Y-axis flip
          const cMag = Math.sqrt(cdx * cdx + cdy * cdy);
          const nx = cdx / cMag;
          const ny = cdy / cMag;

          // Arrow starts at circle edge; length floored at BETA_FLOOR × MAX.
          const arrowLen = Math.max(beta, BETA_FLOOR) * MAX_VEL_ARROW_PX;
          const stemStartX = mp.x + nx * radius;
          const stemStartY = mp.y + ny * radius;
          const tipX = stemStartX + nx * arrowLen;
          const tipY = stemStartY + ny * arrowLen;

          // Open V arrowhead — field-sandbox style: two strokes, not a filled triangle.
          // Wings: 10px back from tip, ±5.5px perpendicular. No trig needed.
          // Perpendicular to (nx, ny): left = (−ny, nx), right = (ny, −nx).
          const w1x = tipX - nx * HEAD_LEN - ny * 5.5;
          const w1y = tipY - ny * HEAD_LEN + nx * 5.5;
          const w2x = tipX - nx * HEAD_LEN + ny * 5.5;
          const w2y = tipY - ny * HEAD_LEN - nx * 5.5;

          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = 1;

          // Glow underlay — solid, wide, low alpha (field-sandbox pattern).
          ctx.strokeStyle = 'rgba(159,247,255,0.18)';
          ctx.lineWidth = 5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(stemStartX, stemStartY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Dashed stem — matches field-sandbox strokeDasharray="8 7".
          ctx.strokeStyle = 'rgba(159,247,255,0.85)';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([8, 7]);
          ctx.beginPath();
          ctx.moveTo(stemStartX, stemStartY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Solid open V arrowhead (no dash on wings).
          ctx.setLineDash([]);
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(w1x, w1y);
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(w2x, w2y);
          ctx.stroke();

          // Speed label — anchored just past the arrowhead tip in the arrow direction.
          // Dark shadow ensures legibility over bright field arrows.
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

        // Charge circle and sign label.
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7a3f';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,120,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = `bold ${radius + 3}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;
        ctx.fillText('+', mp.x, mp.y);

        ctx.restore();
      }
    }

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [historyRef, simulationTimeRef, chargeRef, configRef, gridW, gridH]);

  return <canvas ref={canvasRef} style={style} />;
}

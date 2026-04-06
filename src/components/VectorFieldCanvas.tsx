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

type Props = {
  historyRef: RefObject<ChargeHistory>;
  simulationTimeRef: RefObject<number>;
  chargeRef: RefObject<number>;
  configRef: RefObject<SimConfig>;
  bounds: WorldBounds;
  gridW?: number; // default 40
  gridH?: number; // default 40
  fieldLayer: 'total' | 'vel' | 'accel';
  /**
   * True while the user is panning. Reserved for a future quality tradeoff
   * (e.g., reduce grid density during pan). Currently unused in M2.
   */
  isPanning?: boolean;
  /** Forwarded to the canvas element. Caller uses position:absolute inset:0. */
  style?: CSSProperties;
};

function drawArrow(ctx: CanvasRenderingContext2D, spec: ArrowSpec): void {
  const { x0, y0, x1, y1, headX, headY, wingAngle, headLength, lineWidth, alpha, color, glowBlur, glowAlpha } = spec;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  const ux = dx / len;
  const uy = dy / len;

  // Wing endpoints: rotate backward direction (−ux, −uy) by ±wingAngle.
  // Rotation of (−ux, −uy) by +θ: (−ux·cosθ + uy·sinθ, −ux·sinθ − uy·cosθ)
  // Rotation of (−ux, −uy) by −θ: (−ux·cosθ − uy·sinθ,  ux·sinθ − uy·cosθ)
  const cos = Math.cos(wingAngle);
  const sin = Math.sin(wingAngle);
  const w1x = headX + headLength * (-ux * cos + uy * sin);
  const w1y = headY + headLength * (-ux * sin - uy * cos);
  const w2x = headX + headLength * (-ux * cos - uy * sin);
  const w2y = headY + headLength * (ux * sin - uy * cos);

  const rgb = `rgb(${color.r},${color.g},${color.b})`;
  ctx.strokeStyle = rgb;
  ctx.fillStyle = rgb;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Glow pass — wider stroke on stem, blurred filled triangle on head.
  if (glowBlur > 0) {
    ctx.globalAlpha = glowAlpha;
    ctx.lineWidth = lineWidth + 2;
    ctx.shadowBlur = glowBlur;
    ctx.shadowColor = rgb;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(w1x, w1y);
    ctx.lineTo(w2x, w2y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  // Core pass — crisp stem stroke + filled triangle arrowhead (field-sandbox style).
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineWidth;

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

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
  // isPanning is reserved for a future quality tradeoff (e.g., reduce grid density
  // during active pan). Not used in M2.
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mirror props into refs so the RAF closure always reads current values
  // without needing to restart the effect when props change.
  const boundsRef = useRef(bounds);
  const fieldLayerRef = useRef(fieldLayer);
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);
  useEffect(() => { fieldLayerRef.current = fieldLayer; }, [fieldLayer]);

  // Main RAF loop. Restarts only if grid dimensions change (rare).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;

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
    });
    ro.observe(canvas);

    function frame() {
      rafId = requestAnimationFrame(frame);
      if (!canvas || !ctx) return; // re-check: TypeScript closure narrowing limitation

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      const currentBounds = boundsRef.current;
      const transform = getWorldToScreenTransform(currentBounds, cssW, cssH);
      const spanX = currentBounds.maxX - currentBounds.minX;
      const spanY = currentBounds.maxY - currentBounds.minY;
      const layer = fieldLayerRef.current;

      const history = historyRef.current;
      const simTime = simulationTimeRef.current;
      const charge = chargeRef.current;
      const config = configRef.current;

      // Arrow length cap: grid cell size × 0.45 prevents arrows exceeding their cell
      // when zoomed in. field-sandbox avoids this with fixed screen-space spacing;
      // we use a world-space grid so the cap is computed per frame from canvas size.
      const gridSpacingPx = Math.min(cssW / gridW, cssH / gridH);
      const maxLengthPx = gridSpacingPx * 0.45;

      // Evaluate LW field at each grid point and fill the pre-allocated pool.
      // obsPos is mutated in place — no per-grid-point allocation.
      // transformWorldPoint is inlined to avoid a Vec2 allocation per point.
      let arrowCount = 0;
      for (let j = 0; j < gridH; j++) {
        for (let i = 0; i < gridW; i++) {
          obsPos.x = currentBounds.minX + (i + 0.5) * spanX / gridW;
          obsPos.y = currentBounds.minY + (j + 0.5) * spanY / gridH;

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

      // Draw all arrows.
      for (let k = 0; k < arrowCount; k++) {
        drawArrow(ctx, arrowPool[k]);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Draw source charge marker from newest recorded state.
      // newest() is null before the first reseed completes (brief window during mount).
      const newest = history.newest();
      if (newest !== null) {
        const mp = transformWorldPoint(newest.pos, transform);
        const radius = 8;

        ctx.save();
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

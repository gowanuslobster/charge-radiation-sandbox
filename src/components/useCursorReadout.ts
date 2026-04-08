// useCursorReadout — RAF-batched field evaluation at the cursor position.
//
// Listens for pointermove/pointerleave on the canvas element (not the container),
// so the readout clears automatically when the cursor crosses into the control panel.
//
// Re-evaluates the LW field only when at least one of five inputs changes:
//   hover position, simulation time, sim epoch (reseed/mode switch), c, or view bounds.
// View bounds are included because getWorldFromClientPoint reads live camera refs —
// a pan or zoom while the cursor is still changes the world point without any other
// tracked value changing, which would leave the readout stale.
//
// On pointerleave all last-evaluated refs are also reset so that re-entering the canvas
// at the same screen coordinates while paused triggers a fresh solve instead of staying blank.

import { useState, useRef, useEffect, type RefObject, type MutableRefObject } from 'react';
import type { ChargeHistory } from '@/physics/chargeHistory';
import type { SimConfig, Vec2 } from '@/physics/types';
import type { WorldBounds } from '@/rendering/worldSpace';
import { evaluateLienardWiechertField } from '@/physics/lienardWiechert';

export type CursorReadout = { eTotal: number; eVel: number; eAccel: number } | null;

interface UseCursorReadoutOptions {
  canvasRef:               RefObject<HTMLCanvasElement | null>;
  historyRef:              RefObject<ChargeHistory>;
  simTimeRef:              RefObject<number>;
  simEpochRef:             RefObject<number>;
  chargeRef:               RefObject<number>;
  configRef:               RefObject<SimConfig>;
  viewBoundsRef:           RefObject<WorldBounds>;
  getWorldFromClientPoint: (cx: number, cy: number) => Vec2 | null;
}

export function useCursorReadout({
  canvasRef,
  historyRef,
  simTimeRef,
  simEpochRef,
  chargeRef,
  configRef,
  viewBoundsRef,
  getWorldFromClientPoint,
}: UseCursorReadoutOptions): CursorReadout {
  const [readout, setReadout] = useState<CursorReadout>(null);

  // Shared between the pointer-listener effect and the RAF-loop effect.
  const pendingHoverRef = useRef<{ x: number; y: number } | null>(null);

  // Last-evaluated key — re-evaluate only when any of these change.
  // All are initialized to sentinel values that will never match a real frame,
  // so the first tick after hover always triggers a solve.
  const lastEvaluatedPos    = useRef<{ x: number; y: number } | null>(null);
  const lastEvaluatedSimTime = useRef(NaN);
  const lastEvaluatedEpoch   = useRef(NaN);
  const lastEvaluatedC       = useRef(NaN);
  const lastEvaluatedMinX    = useRef(NaN);
  const lastEvaluatedMaxX    = useRef(NaN);
  const lastEvaluatedMinY    = useRef(NaN);
  const lastEvaluatedMaxY    = useRef(NaN);

  // Helper: reset all cache entries to their sentinel values.
  // Called on pointerleave so that re-entering at the same client coordinates
  // while paused always triggers a fresh solve instead of staying blank.
  function resetCache() {
    lastEvaluatedPos.current     = null;
    lastEvaluatedSimTime.current = NaN;
    lastEvaluatedEpoch.current   = NaN;
    lastEvaluatedC.current       = NaN;
    lastEvaluatedMinX.current    = NaN;
    lastEvaluatedMaxX.current    = NaN;
    lastEvaluatedMinY.current    = NaN;
    lastEvaluatedMaxY.current    = NaN;
  }

  // Pointer listeners on the canvas element.
  // canvas-scope means the readout clears when the cursor leaves the canvas
  // surface, including when it enters the floating control panel.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMove = (e: PointerEvent) => {
      pendingHoverRef.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pendingHoverRef.current = null;
      resetCache();
      setReadout(null);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [canvasRef]);

  // RAF loop: evaluate LW field when any cache key changes.
  useEffect(() => {
    let rafId: number;

    function tick() {
      rafId = requestAnimationFrame(tick);

      const pending = pendingHoverRef.current;
      if (pending === null) return;

      const vb = viewBoundsRef.current;
      const changed =
        pending.x !== lastEvaluatedPos.current?.x ||
        pending.y !== lastEvaluatedPos.current?.y ||
        simTimeRef.current  !== lastEvaluatedSimTime.current ||
        simEpochRef.current !== lastEvaluatedEpoch.current   ||
        configRef.current.c !== lastEvaluatedC.current       ||
        vb.minX !== lastEvaluatedMinX.current ||
        vb.maxX !== lastEvaluatedMaxX.current ||
        vb.minY !== lastEvaluatedMinY.current ||
        vb.maxY !== lastEvaluatedMaxY.current;

      if (!changed) return;

      // Transform unavailable before first ResizeObserver measurement.
      const worldPos = getWorldFromClientPoint(pending.x, pending.y);
      if (worldPos === null) return;

      const result = evaluateLienardWiechertField({
        observationPos:  worldPos,
        observationTime: simTimeRef.current,
        history:         historyRef.current,
        charge:          chargeRef.current,
        config:          configRef.current,
      });

      if (result !== null) {
        setReadout({
          eTotal: Math.sqrt(result.eTotal.x ** 2 + result.eTotal.y ** 2),
          eVel:   Math.sqrt(result.eVel.x   ** 2 + result.eVel.y   ** 2),
          eAccel: Math.sqrt(result.eAccel.x  ** 2 + result.eAccel.y  ** 2),
        });
      } else {
        setReadout(null);
      }

      lastEvaluatedPos.current     = pending;
      lastEvaluatedSimTime.current = simTimeRef.current;
      lastEvaluatedEpoch.current   = simEpochRef.current;
      lastEvaluatedC.current       = configRef.current.c;
      lastEvaluatedMinX.current    = vb.minX;
      lastEvaluatedMaxX.current    = vb.maxX;
      lastEvaluatedMinY.current    = vb.minY;
      lastEvaluatedMaxY.current    = vb.maxY;
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  // Refs are stable objects; getWorldFromClientPoint is a stable useCallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return readout;
}

// Re-export MutableRefObject so callers don't need to import it from react directly.
export type { MutableRefObject };

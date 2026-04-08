// dragKinematics.ts — kinematic helpers for draggable mode.
//
// Pure functions only — no React, no DOM.
// Called exclusively from the simulation tick in ChargeRadiationSandbox.tsx.
// The tick owns simulation time and dt; these helpers do not touch wall-clock time.

import type { Vec2 } from './types';

export type DragState = {
  pos: Vec2;
  vel: Vec2;
  accel: Vec2;
};

// EMA smoothing factor for velocity estimation.
// Higher value → faster response, more noise. Lower → smoother, more lag.
const EMA_ALPHA = 0.35;

// Hard cap: |vel| ≤ MAX_DRAG_BETA × c at all times.
// Prevents the charge from reaching or exceeding c regardless of how fast
// the user moves the pointer.
const MAX_DRAG_BETA = 0.92;

// Guard against zero-dt: clamp dt from below so vel/accel don't blow up
// if two ticks land at the same wall-clock millisecond.
const MIN_DT = 1 / 240;

/**
 * Advance drag kinematics by one simulation tick.
 *
 * Zero-motion guard: if prev !== null and newPos equals prev.pos (the pointer
 * has not moved since the last tick), returns pos=newPos, vel={0,0}, accel={0,0}.
 * This prevents EMA decay from producing a nonzero-vel / fixed-pos state while
 * the user holds the charge still.
 *
 * Otherwise:
 *   rawVel = (newPos − prev.pos) / dt
 *   vel    = EMA_ALPHA × rawVel + (1 − EMA_ALPHA) × prev.vel
 *   vel    = clamp |vel| to MAX_DRAG_BETA × c
 *   accel  = (vel − prev.vel) / dt   (finite-difference, also EMA-smoothed)
 *
 * prev is null on the very first tick after drag start; vel/accel are zeroed.
 */
export function computeDragState(
  newPos: Vec2,
  prev: DragState | null,
  dt: number,
  c: number,
): DragState {
  const safeDt = Math.max(dt, MIN_DT);

  // First sample: no previous state to difference against.
  if (prev === null) {
    return { pos: newPos, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
  }

  // Zero-motion guard: pointer hasn't moved — freeze kinematics.
  if (newPos.x === prev.pos.x && newPos.y === prev.pos.y) {
    return { pos: newPos, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
  }

  // Raw finite-difference velocity.
  const rawVx = (newPos.x - prev.pos.x) / safeDt;
  const rawVy = (newPos.y - prev.pos.y) / safeDt;

  // EMA smoothing.
  let vx = EMA_ALPHA * rawVx + (1 - EMA_ALPHA) * prev.vel.x;
  let vy = EMA_ALPHA * rawVy + (1 - EMA_ALPHA) * prev.vel.y;

  // Speed cap.
  const maxSpeed = MAX_DRAG_BETA * c;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    vx *= scale;
    vy *= scale;
  }

  // Finite-difference acceleration from the smoothed velocity.
  const ax = (vx - prev.vel.x) / safeDt;
  const ay = (vy - prev.vel.y) / safeDt;

  return {
    pos: newPos,
    vel: { x: vx, y: vy },
    accel: { x: ax, y: ay },
  };
}

/**
 * Stopped state: frozen pos, vel/accel zeroed.
 * Used when the user releases the charge or when pause ends a drag.
 */
export function stoppedDragState(pos: Vec2): DragState {
  return { pos, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
}

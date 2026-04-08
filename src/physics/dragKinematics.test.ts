import { describe, it, expect } from 'vitest';
import { computeDragState, stoppedDragState } from './dragKinematics';

const C = 1.0;
const DT = 1 / 60;

describe('computeDragState', () => {
  it('returns zeroed vel/accel when prev is null (first sample)', () => {
    const state = computeDragState({ x: 1, y: 2 }, null, DT, C);
    expect(state.pos).toEqual({ x: 1, y: 2 });
    expect(state.vel).toEqual({ x: 0, y: 0 });
    expect(state.accel).toEqual({ x: 0, y: 0 });
  });

  it('zero-motion guard: returns vel/accel = 0 when newPos equals prev.pos', () => {
    const prev = { pos: { x: 1, y: 2 }, vel: { x: 3, y: 4 }, accel: { x: 1, y: 1 } };
    const state = computeDragState({ x: 1, y: 2 }, prev, DT, C);
    expect(state.pos).toEqual({ x: 1, y: 2 });
    expect(state.vel).toEqual({ x: 0, y: 0 });
    expect(state.accel).toEqual({ x: 0, y: 0 });
  });

  it('estimates velocity from position difference / dt', () => {
    // After one tick from rest with displacement (dx, 0), raw vel = dx/dt.
    // With EMA_ALPHA = 0.35 and prev.vel = 0: vel.x = 0.35 * (dx/dt).
    // Use dt = 1 s so raw vel = dx = 0.1, safely below the 0.92*c speed cap.
    const dx = 0.1;
    const slowDt = 1.0;
    const prev = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
    const state = computeDragState({ x: dx, y: 0 }, prev, slowDt, C);
    const expectedVx = 0.35 * (dx / slowDt);
    expect(state.vel.x).toBeCloseTo(expectedVx, 5);
    expect(state.vel.y).toBeCloseTo(0, 10);
  });

  it('EMA smoothing: velocity converges across multiple samples', () => {
    // Constant displacement per tick → raw vel is constant → EMA converges to raw vel.
    const dx = 0.01; // small enough that speed cap is never hit
    let state = computeDragState({ x: dx, y: 0 }, null, DT, C);
    for (let i = 1; i < 40; i++) {
      state = computeDragState({ x: dx * (i + 1), y: 0 }, state, DT, C);
    }
    const rawVel = dx / DT;
    // After 40 ticks of constant raw vel, EMA should be within 1% of rawVel.
    expect(Math.abs(state.vel.x - rawVel) / rawVel).toBeLessThan(0.01);
  });

  it('speed cap: |vel| never exceeds MAX_DRAG_BETA * c', () => {
    // Enormous displacement per tick to trigger the cap.
    const hugeDisp = 100;
    const prev = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
    const state = computeDragState({ x: hugeDisp, y: 0 }, prev, DT, C);
    const speed = Math.sqrt(state.vel.x ** 2 + state.vel.y ** 2);
    expect(speed).toBeLessThanOrEqual(0.92 * C + 1e-10);
  });

  it('speed cap applies regardless of direction', () => {
    const hugeDisp = 100;
    const prev = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
    const state = computeDragState({ x: hugeDisp, y: hugeDisp }, prev, DT, C);
    const speed = Math.sqrt(state.vel.x ** 2 + state.vel.y ** 2);
    expect(speed).toBeLessThanOrEqual(0.92 * C + 1e-10);
  });

  it('peak speed is the caller\'s responsibility — computeDragState does not track it', () => {
    // Just verify the returned state doesn't carry a peakSpeed field.
    const state = computeDragState({ x: 1, y: 0 }, null, DT, C);
    expect((state as Record<string, unknown>).peakSpeed).toBeUndefined();
  });
});

describe('stoppedDragState', () => {
  it('preserves pos and zeroes vel/accel', () => {
    const pos = { x: 3.5, y: -1.2 };
    const state = stoppedDragState(pos);
    expect(state.pos).toEqual(pos);
    expect(state.vel).toEqual({ x: 0, y: 0 });
    expect(state.accel).toEqual({ x: 0, y: 0 });
  });
});

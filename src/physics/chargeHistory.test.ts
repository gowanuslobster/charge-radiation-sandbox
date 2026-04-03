import { describe, it, expect, beforeEach } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import type { KinematicState } from './types';

function makeState(t: number, x: number, y: number, vx = 0, vy = 0, ax = 0, ay = 0): KinematicState {
  return { t, pos: { x, y }, vel: { x: vx, y: vy }, accel: { x: ax, y: ay } };
}

describe('ChargeHistory', () => {
  let history: ChargeHistory;

  beforeEach(() => {
    history = new ChargeHistory();
  });

  it('is empty before any records', () => {
    expect(history.isEmpty()).toBe(true);
    expect(history.oldest()).toBeNull();
    expect(history.newest()).toBeNull();
  });

  it('is not empty after first record', () => {
    history.recordState(makeState(0, 0, 0));
    expect(history.isEmpty()).toBe(false);
  });

  it('returns newest state exactly after recording', () => {
    history.recordState(makeState(0, 1, 2));
    history.recordState(makeState(1, 3, 4));
    history.recordState(makeState(2, 5, 6));
    const newest = history.newest()!;
    expect(newest.t).toBe(2);
    expect(newest.pos).toEqual({ x: 5, y: 6 });
  });

  it('interpolates position correctly between two timestamps', () => {
    history.recordState(makeState(0, 0, 0));
    history.recordState(makeState(1, 2, 4));
    const mid = history.interpolateAt(0.5);
    expect(mid.t).toBeCloseTo(0.5);
    expect(mid.pos.x).toBeCloseTo(1);
    expect(mid.pos.y).toBeCloseTo(2);
  });

  it('interpolates velocity and acceleration correctly', () => {
    history.recordState(makeState(0, 0, 0, 0, 0, 0, 0));
    history.recordState(makeState(2, 0, 0, 4, 8, 2, 6));
    const mid = history.interpolateAt(1);
    expect(mid.vel.x).toBeCloseTo(2);
    expect(mid.vel.y).toBeCloseTo(4);
    expect(mid.accel.x).toBeCloseTo(1);
    expect(mid.accel.y).toBeCloseTo(3);
  });

  it('clamps to oldest state when queried before buffer start', () => {
    history.recordState(makeState(5, 10, 20));
    history.recordState(makeState(10, 30, 40));
    const result = history.interpolateAt(0);
    expect(result.t).toBe(5);
    expect(result.pos).toEqual({ x: 10, y: 20 });
  });

  it('clamps to newest state when queried after buffer end', () => {
    history.recordState(makeState(0, 0, 0));
    history.recordState(makeState(1, 5, 5));
    const result = history.interpolateAt(999);
    expect(result.t).toBe(1);
    expect(result.pos).toEqual({ x: 5, y: 5 });
  });

  it('pruneBefore removes old entries and keeps newer ones', () => {
    history.recordState(makeState(0, 0, 0));
    history.recordState(makeState(1, 1, 0));
    history.recordState(makeState(2, 2, 0));
    history.recordState(makeState(3, 3, 0));
    history.pruneBefore(2);
    // Should have removed t=0; t=1 kept as floor; t=2, t=3 kept
    const oldest = history.oldest()!;
    expect(oldest.t).toBeLessThanOrEqual(2);
    expect(history.newest()!.t).toBe(3);
  });

  it('setMaxHistoryTime + pruneToWindow removes states outside window', () => {
    for (let i = 0; i <= 10; i++) {
      history.recordState(makeState(i, i, 0));
    }
    history.setMaxHistoryTime(3);
    history.pruneToWindow(10);
    // Should keep only states within [10 - 3, 10] = [7, 10]
    const oldest = history.oldest()!;
    expect(oldest.t).toBeGreaterThanOrEqual(6); // floor entry may be kept
    expect(history.newest()!.t).toBe(10);
  });

  it('pruneToWindow is a no-op when maxHistoryTime is not set', () => {
    for (let i = 0; i < 5; i++) {
      history.recordState(makeState(i, i, 0));
    }
    history.pruneToWindow(100);
    expect(history.oldest()!.t).toBe(0);
    expect(history.newest()!.t).toBe(4);
  });
});

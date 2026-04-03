import { describe, it, expect } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import { solveRetardedState } from './retardedTime';
import type { KinematicState } from './types';

const C = 1.0; // speed of light for tests

function makeState(t: number, x: number, y: number, vx = 0, vy = 0): KinematicState {
  return { t, pos: { x, y }, vel: { x: vx, y: vy }, accel: { x: 0, y: 0 } };
}

/** Build a history with densely sampled states for a stationary charge at origin. */
function buildStationaryHistory(tMax: number, dt = 0.01): ChargeHistory {
  const h = new ChargeHistory();
  for (let t = 0; t <= tMax; t += dt) {
    h.recordState(makeState(t, 0, 0));
  }
  return h;
}

/** Build a history for a charge moving at constant velocity vx. */
function buildMovingHistory(tMax: number, vx: number, dt = 0.01): ChargeHistory {
  const h = new ChargeHistory();
  for (let t = 0; t <= tMax; t += dt) {
    h.recordState(makeState(t, vx * t, 0, vx, 0));
  }
  return h;
}

describe('solveRetardedState', () => {
  it('returns null for empty history', () => {
    const history = new ChargeHistory();
    const result = solveRetardedState({
      observationPos: { x: 1, y: 0 },
      observationTime: 1,
      history,
      c: C,
    });
    expect(result).toBeNull();
  });

  it('converges for a stationary charge within maxIterations', () => {
    // Stationary charge at origin; observer at (3, 0) at t=5.
    // Retarded time should be t_ret ≈ 5 - 3/1 = 2.
    const history = buildStationaryHistory(10);
    const result = solveRetardedState({
      observationPos: { x: 3, y: 0 },
      observationTime: 5,
      history,
      c: C,
    });
    expect(result).not.toBeNull();
    expect(result!.converged).toBe(true);
    expect(result!.iterations).toBeLessThanOrEqual(15);
    expect(result!.tRet).toBeCloseTo(2, 3);
  });

  it('converges for a uniformly moving charge within maxIterations', () => {
    // Charge moving at vx = 0.5c; observer at (5, 0) at t = 10.
    const vx = 0.5 * C;
    const history = buildMovingHistory(10, vx);
    const result = solveRetardedState({
      observationPos: { x: 5, y: 0 },
      observationTime: 10,
      history,
      c: C,
    });
    expect(result).not.toBeNull();
    expect(result!.converged).toBe(true);
    expect(result!.iterations).toBeLessThanOrEqual(15);
    // Retarded time should be self-consistent: t_ret = tObs - |obsPos - pos(t_ret)| / c
    const tRet = result!.tRet;
    const xRet = vx * tRet;
    const dist = Math.abs(5 - xRet);
    expect(10 - dist / C).toBeCloseTo(tRet, 3);
  });

  it('returns usedClampFallback = true when needed t_ret predates buffer', () => {
    // Observer is very far away; retarded time would be in the distant past.
    const history = buildStationaryHistory(1); // only t in [0, 1]
    const result = solveRetardedState({
      observationPos: { x: 1000, y: 0 }, // dist = 1000, t_ret = 5 - 1000 < 0
      observationTime: 5,
      history,
      c: C,
    });
    expect(result).not.toBeNull();
    expect(result!.usedClampFallback).toBe(true);
    expect(result!.state.t).toBe(result!.tRet);
  });

  it('returns a usable (non-null, non-throw) result in degenerate cases', () => {
    // Observer very close to charge (near-zero distance) — tests softness of solver.
    const history = buildStationaryHistory(5);
    const result = solveRetardedState({
      observationPos: { x: 1e-6, y: 0 },
      observationTime: 3,
      history,
      c: C,
    });
    expect(result).not.toBeNull();
    // Should not throw, and should return something (converged or not).
    expect(result!.iterations).toBeGreaterThan(0);
  });

  it('respects maxIterations cap — never spins past it', () => {
    const history = buildStationaryHistory(5);
    const result = solveRetardedState({
      observationPos: { x: 2, y: 0 },
      observationTime: 4,
      history,
      c: C,
      maxIterations: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.iterations).toBeLessThanOrEqual(3);
  });
});

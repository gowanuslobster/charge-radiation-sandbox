// Retarded-time solver for Liénard-Wiechert physics.
//
// The retarded time t_ret is the unique past time satisfying:
//   t_ret = t_obs - |r_obs - r_source(t_ret)| / c
//
// This is an implicit equation: the field at (r_obs, t_obs) depends on where
// the charge WAS at the moment the light-speed signal it emitted arrived at r_obs.
// We solve it by fixed-point iteration.
//
// This module owns root-finding only. History storage lives in chargeHistory.ts.

import type { RetardedSolveResult, Vec2 } from './types';
import { ChargeHistory } from './chargeHistory';
import { distance } from './vec2';

export type SolveRetardedParams = {
  observationPos: Vec2;
  observationTime: number;
  history: ChargeHistory;
  c: number;
  /** Maximum fixed-point iterations (default: 15). Hard cap — no while loops. */
  maxIterations?: number;
  /**
   * Convergence tolerance in time units (default: 1e-9 / c).
   * Scaling by 1/c makes this invariant to the simulation's speed-of-light setting.
   */
  tolerance?: number;
  /**
   * Warm-start seed: the solved tRet from the previous frame for the same observation point.
   * When provided, replaces the default newest-position bootstrap as the initial iterate.
   * For smoothly evolving charge motion, this dramatically reduces iteration count because
   * the previous solution is very close to the current one. Callers that don't have a cached
   * value (first frame, after invalidation) should omit this field or pass undefined.
   */
  cachedTRet?: number;
};

/**
 * Solve for the retarded time using capped fixed-point iteration.
 *
 * Returns null if the history is empty — this is a normal operational state
 * (first frame before any state has been recorded, or history cleared after a c change).
 * Callers must null-check the return value.
 *
 * On non-convergence, returns the best available iterate with converged = false.
 * Never throws for ordinary physics degeneracies (nearby charge, thin history, etc.).
 *
 * Precondition: observationTime must be <= the time of the newest recorded history entry.
 * If observationTime is newer than all recorded states, tRet = tObs − dist/c may still
 * be <= newest.t (field evaluation is always in the past), so in practice the solver
 * handles this correctly. However, if the charge is extremely close (dist ≈ 0), tRet ≈ tObs
 * can exceed newest.t, causing interpolateAt to silently clamp — this edge case is not
 * flagged by usedClampFallback (which only detects underruns below oldest.t). Callers
 * should ensure the present state is recorded before calling this function.
 */
export function solveRetardedState(params: SolveRetardedParams): RetardedSolveResult | null {
  const {
    observationPos,
    observationTime,
    history,
    c,
    maxIterations = 15,
    tolerance = 1e-9 / c,
  } = params;

  // Empty history is a normal first-frame state, not an error.
  if (history.isEmpty()) return null;

  const newestState = history.newest()!;
  const oldestState = history.oldest()!;

  // Initial guess: use the warm-start seed if provided (previous-frame solution for this cell),
  // otherwise fall back to the newest-position bootstrap.
  // The warm-start is much more accurate for smoothly-evolving charge motion.
  let tGuess = params.cachedTRet !== undefined
    ? params.cachedTRet
    : observationTime - distance(observationPos, newestState.pos) / c;

  let converged = false;
  let iterations = 0;
  let state = history.interpolateAt(tGuess);

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    const newTGuess = observationTime - distance(observationPos, state.pos) / c;

    if (Math.abs(newTGuess - tGuess) < tolerance) {
      tGuess = newTGuess;
      state = history.interpolateAt(tGuess);
      converged = true;
      break;
    }

    tGuess = newTGuess;
    state = history.interpolateAt(tGuess);
  }

  // If the converged (or best-effort) t_ret predates the oldest available state,
  // clamp to the oldest state. Fields computed from a clamped state are approximate;
  // the charge's past is simply not recorded far enough back.
  const usedClampFallback = tGuess < oldestState.t;
  if (usedClampFallback) {
    return {
      tRet: oldestState.t,
      state: oldestState,
      converged,
      iterations,
      usedClampFallback: true,
    };
  }

  return {
    tRet: tGuess,
    state,
    converged,
    iterations,
    usedClampFallback: false,
  };
}

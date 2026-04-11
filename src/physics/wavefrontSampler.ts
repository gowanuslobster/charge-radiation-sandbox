// wavefrontSampler.ts — coarse scalar grid sampler for the M6 wavefront overlay.
//
// Evaluates bZAccel (the radiative magnetic component) on a regular grid of world-space
// observation points. Uses a per-cell retarded-time warm-start cache to reduce iteration
// count across frames: the previous frame's solved tRet is a much better initial guess
// than the default newest-position bootstrap for smoothly evolving charge motion.
//
// Pure physics layer: no rendering imports, no UI mode concepts.
// Always returns signed bZAccel. The rendering layer applies abs() for envelope display.

import type { SamplerBounds, SimConfig } from './types';
import { ChargeHistory } from './chargeHistory';
import { solveRetardedState } from './retardedTime';
import { evaluateLWFieldFromState } from './lienardWiechert';

export type WavefrontSamplerParams = {
  history: ChargeHistory;
  simTime: number;
  charge: number;
  config: SimConfig;
  /**
   * World-space axis-aligned bounds covering the sample lattice.
   * The grid spans [minX, maxX] × [minY, maxY] with gridW × gridH evenly-spaced cells.
   */
  bounds: SamplerBounds;
  /** Number of sample columns. */
  gridW: number;
  /** Number of sample rows. */
  gridH: number;
  /**
   * Simulation epoch from simEpochRef. Any increment triggers a full cache reset,
   * meaning all cells revert to a cold-start solve on the next call.
   */
  simEpoch: number;
};

export type WavefrontSamplerState = {
  /**
   * Per-cell cached retarded times. Indexed row-major: cell (i, j) → j * gridW + i.
   * NaN means the cell has not been solved yet or the cache was invalidated.
   */
  cachedTRet: Float64Array;
  /** Last bounds used — used to detect camera changes that require a cache reset. */
  lastBounds: SamplerBounds | null;
  lastC: number;
  lastEpoch: number;
  lastGridW: number;
  lastGridH: number;
};

/** Create a fresh sampler state. Call once and store in a ref. */
export function createSamplerState(): WavefrontSamplerState {
  return {
    cachedTRet: new Float64Array(0),
    lastBounds: null,
    lastC: NaN,
    lastEpoch: NaN,
    lastGridW: 0,
    lastGridH: 0,
  };
}

/**
 * Sample bZAccel (signed) at each cell of a gridW × gridH lattice covering `bounds`.
 *
 * Cell (i, j) occupies column i [0, gridW) and row j [0, gridH).
 * Output index: j * gridW + i (row-major).
 *
 * Mutates `state.cachedTRet` in place with updated solved tRet values.
 * One retarded-time solve per cell — no redundant solves.
 */
export function sampleWavefront(
  state: WavefrontSamplerState,
  params: WavefrontSamplerParams,
): Float32Array {
  const { history, simTime, charge, config, bounds, gridW, gridH, simEpoch } = params;
  const n = gridW * gridH;

  // ── Cache invalidation ─────────────────────────────────────────────────────
  // Any change to the sample lattice or physics parameters requires a cold-start
  // on the next sample pass. We signal this by filling cachedTRet with NaN.
  const needsReset =
    state.lastGridW !== gridW ||
    state.lastGridH !== gridH ||
    state.lastEpoch !== simEpoch ||
    state.lastC     !== config.c ||
    !boundsEqual(state.lastBounds, bounds);

  if (needsReset || state.cachedTRet.length !== n) {
    state.cachedTRet = new Float64Array(n).fill(NaN);
  }

  // Update bookkeeping before the solve loop so that even a partial run (e.g.
  // early return on empty history) leaves the state consistent for the next call.
  state.lastGridW  = gridW;
  state.lastGridH  = gridH;
  state.lastEpoch  = simEpoch;
  state.lastC      = config.c;
  state.lastBounds = { ...bounds };

  // ── Sample each cell ───────────────────────────────────────────────────────
  const output = new Float32Array(n);

  if (history.isEmpty()) return output; // all zeros; valid first-frame state

  const xStep = gridW > 1 ? (bounds.maxX - bounds.minX) / (gridW - 1) : 0;
  const yStep = gridH > 1 ? (bounds.maxY - bounds.minY) / (gridH - 1) : 0;

  for (let j = 0; j < gridH; j++) {
    for (let i = 0; i < gridW; i++) {
      const idx = j * gridW + i;

      const obsX = bounds.minX + i * xStep;
      const obsY = bounds.minY + j * yStep;
      const observationPos = { x: obsX, y: obsY };

      // Use the warm-start seed if available (not NaN), otherwise let the solver
      // fall back to its default newest-position bootstrap.
      const cachedTRet = state.cachedTRet[idx];
      const solveResult = solveRetardedState({
        observationPos,
        observationTime: simTime,
        history,
        c: config.c,
        cachedTRet: Number.isNaN(cachedTRet) ? undefined : cachedTRet,
      });

      if (solveResult === null) {
        // History was empty mid-loop (shouldn't happen, but safe to handle).
        output[idx] = 0;
        continue;
      }

      // Update warm-start cache with the solved tRet for this frame.
      state.cachedTRet[idx] = solveResult.tRet;

      const field = evaluateLWFieldFromState(solveResult, observationPos, charge, config);
      output[idx] = field.bZAccel; // signed; rendering layer applies abs() for envelope mode
    }
  }

  return output;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function boundsEqual(a: SamplerBounds | null, b: SamplerBounds): boolean {
  if (a === null) return false;
  return a.minX === b.minX && a.maxX === b.maxX &&
         a.minY === b.minY && a.maxY === b.maxY;
}

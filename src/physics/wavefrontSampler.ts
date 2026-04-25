// wavefrontSampler.ts — coarse scalar grid sampler for the wavefront overlay.
//
// Evaluates the three magnetic-field components (bZ, bZVel, bZAccel) on a regular grid of
// world-space observation points. Uses a per-cell retarded-time warm-start cache to reduce
// iteration count across frames: the previous frame's solved tRet is a much better initial
// guess than the default newest-position bootstrap for smoothly evolving charge motion.
//
// Pure physics layer: no rendering imports, no UI mode concepts.
// All three buffers are signed. The rendering layer applies abs() / channel selection.

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

/**
 * Sampled scalar output buffers. Row-major, idx = j * gridW + i.
 *
 *   bZ      — total out-of-plane magnetic field
 *   bZVel   — velocity (bound) component of Bz
 *   bZAccel — acceleration (radiative) component of Bz
 *
 * IMPORTANT: the three Float32Arrays are **scratch storage owned by the
 * WavefrontSamplerState**. They are resized in place when the grid changes and
 * overwritten on every call to sampleWavefront. Callers must NOT retain these
 * references past the next sampleWavefront call; if values need to persist,
 * the caller must copy into its own buffer. This mirrors the existing
 * cachedTRet ownership pattern and avoids three per-frame Float32Array
 * allocations per charge.
 */
export type WavefrontSamples = {
  bZ: Float32Array;
  bZVel: Float32Array;
  bZAccel: Float32Array;
};

export type WavefrontSamplerState = {
  /**
   * Per-cell cached retarded times. Indexed row-major: cell (i, j) → j * gridW + i.
   * NaN means the cell has not been solved yet or the cache was invalidated.
   */
  cachedTRet: Float64Array;
  /** Owned output scratch buffers. See WavefrontSamples for ownership rules. */
  bZ: Float32Array;
  bZVel: Float32Array;
  bZAccel: Float32Array;
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
    bZ: new Float32Array(0),
    bZVel: new Float32Array(0),
    bZAccel: new Float32Array(0),
    lastBounds: null,
    lastC: NaN,
    lastEpoch: NaN,
    lastGridW: 0,
    lastGridH: 0,
  };
}

/**
 * Sample bZ, bZVel, bZAccel (signed) at each cell of a gridW × gridH lattice covering `bounds`.
 *
 * Cell (i, j) occupies column i [0, gridW) and row j [0, gridH).
 * Output index: j * gridW + i (row-major).
 *
 * Mutates `state.cachedTRet` and the three scratch output buffers in place.
 * One retarded-time solve per cell feeds all three outputs — no redundant solves.
 *
 * Returned WavefrontSamples references alias `state.{bZ,bZVel,bZAccel}`; they
 * are valid only until the next call to sampleWavefront on the same state.
 */
export function sampleWavefront(
  state: WavefrontSamplerState,
  params: WavefrontSamplerParams,
): WavefrontSamples {
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

  // Resize scratch outputs in place when the grid dimensions change; otherwise
  // zero them so cells we skip (e.g. empty history, unsolved cells) are clean.
  if (state.bZ.length !== n) {
    state.bZ = new Float32Array(n);
    state.bZVel = new Float32Array(n);
    state.bZAccel = new Float32Array(n);
  } else {
    state.bZ.fill(0);
    state.bZVel.fill(0);
    state.bZAccel.fill(0);
  }

  // Update bookkeeping before the solve loop so that even a partial run (e.g.
  // early return on empty history) leaves the state consistent for the next call.
  state.lastGridW  = gridW;
  state.lastGridH  = gridH;
  state.lastEpoch  = simEpoch;
  state.lastC      = config.c;
  state.lastBounds = { ...bounds };

  // ── Sample each cell ───────────────────────────────────────────────────────
  if (history.isEmpty()) {
    return { bZ: state.bZ, bZVel: state.bZVel, bZAccel: state.bZAccel };
  }

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
        continue;
      }

      // Update warm-start cache with the solved tRet for this frame.
      state.cachedTRet[idx] = solveResult.tRet;

      const field = evaluateLWFieldFromState(solveResult, observationPos, charge, config);
      state.bZ[idx]      = field.bZ;
      state.bZVel[idx]   = field.bZVel;
      state.bZAccel[idx] = field.bZAccel;
    }
  }

  return { bZ: state.bZ, bZVel: state.bZVel, bZAccel: state.bZAccel };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function boundsEqual(a: SamplerBounds | null, b: SamplerBounds): boolean {
  if (a === null) return false;
  return a.minX === b.minX && a.maxX === b.maxX &&
         a.minY === b.minY && a.maxY === b.maxY;
}

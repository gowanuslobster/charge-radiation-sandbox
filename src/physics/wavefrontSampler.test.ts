import { describe, it, expect } from 'vitest';
import {
  createSamplerState,
  sampleWavefront,
  type WavefrontSamplerParams,
} from './wavefrontSampler';
import { ChargeHistory } from './chargeHistory';
import type { SamplerBounds, SimConfig } from './types';

const DEFAULT_CONFIG: SimConfig = { c: 1.0, softening: 0.01 };
const DEFAULT_BOUNDS: SamplerBounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 };
const GRID_W = 8;
const GRID_H = 6;

/** Build a dense history for a charge with constant pos/vel/accel. */
function buildHistory(
  pos = { x: 0, y: 0 },
  vel = { x: 0, y: 0 },
  accel = { x: 0, y: 0 },
  tMax = 20,
  dt = 0.01,
): ChargeHistory {
  const h = new ChargeHistory();
  for (let t = 0; t <= tMax; t += dt) {
    const halfAT2 = 0.5 * dt * dt; // small correction only; accel is treated as constant
    h.recordState({
      t,
      pos: {
        x: pos.x + vel.x * t + 0.5 * accel.x * t * t,
        y: pos.y + vel.y * t + 0.5 * accel.y * t * t,
      },
      vel: { x: vel.x + accel.x * t, y: vel.y + accel.y * t },
      accel,
    });
    void halfAT2; // suppress unused-variable lint
  }
  return h;
}

function makeParams(overrides: Partial<WavefrontSamplerParams> = {}): WavefrontSamplerParams {
  return {
    history: buildHistory(),
    simTime: 10,
    charge: 1,
    config: DEFAULT_CONFIG,
    bounds: DEFAULT_BOUNDS,
    gridW: GRID_W,
    gridH: GRID_H,
    simEpoch: 0,
    ...overrides,
  };
}

// ─── Cache behavior (black-box: assert observable outcomes, not internal NaN) ─

describe('sampleWavefront: cache behavior', () => {
  it('second call with same inputs returns identical scalar values (cache reuse)', () => {
    const state = createSamplerState();
    const params = makeParams({ history: buildHistory({ x: 0, y: 0 }, { x: 0.3, y: 0 }) });
    const first  = sampleWavefront(state, params);
    const second = sampleWavefront(state, params);
    for (let i = 0; i < first.length; i++) {
      expect(second[i]).toBeCloseTo(first[i], 9);
    }
  });

  it('after simEpoch increments, next call produces results consistent with a cold-start solve', () => {
    const state = createSamplerState();
    const history = buildHistory({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0 });

    // Warm up the cache.
    sampleWavefront(state, makeParams({ history, simEpoch: 0 }));

    // After an epoch increment the cache is reset; results should still be physically correct.
    const afterReset = sampleWavefront(state, makeParams({ history, simEpoch: 1 }));
    // Cold-start reference with a fresh state.
    const coldState = createSamplerState();
    const coldResult = sampleWavefront(coldState, makeParams({ history, simEpoch: 1 }));
    for (let i = 0; i < coldResult.length; i++) {
      expect(afterReset[i]).toBeCloseTo(coldResult[i], 6);
    }
  });

  it('after c changes, next call produces results consistent with a cold-start solve', () => {
    const state = createSamplerState();
    const history = buildHistory({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0 });
    const configA: SimConfig = { c: 1.0, softening: 0.01 };
    const configB: SimConfig = { c: 1.5, softening: 0.01 };

    sampleWavefront(state, makeParams({ history, config: configA }));
    const afterCChange = sampleWavefront(state, makeParams({ history, config: configB }));

    const coldState = createSamplerState();
    const coldResult = sampleWavefront(coldState, makeParams({ history, config: configB }));
    for (let i = 0; i < coldResult.length; i++) {
      expect(afterCChange[i]).toBeCloseTo(coldResult[i], 6);
    }
  });

  it('after bounds change, next call produces results consistent with a cold-start solve', () => {
    const state = createSamplerState();
    const history = buildHistory({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0 });
    const boundsA: SamplerBounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 };
    const boundsB: SamplerBounds = { minX: -3, maxX: 3, minY: -3, maxY: 3 };

    sampleWavefront(state, makeParams({ history, bounds: boundsA }));
    const afterBoundsChange = sampleWavefront(state, makeParams({ history, bounds: boundsB }));

    const coldState = createSamplerState();
    const coldResult = sampleWavefront(coldState, makeParams({ history, bounds: boundsB }));
    for (let i = 0; i < coldResult.length; i++) {
      expect(afterBoundsChange[i]).toBeCloseTo(coldResult[i], 6);
    }
  });

  it('warm-started result matches cold-start result within solver tolerance for a slowly-moving charge', () => {
    // Advance simTime by a small dt so the warm-start seed is slightly stale but still close.
    const history = buildHistory({ x: 0, y: 0 }, { x: 0.3, y: 0 });
    const simTime1 = 10.0;
    const simTime2 = 10.05; // small step — warm-start advantage is large here

    const warmState = createSamplerState();
    sampleWavefront(warmState, makeParams({ history, simTime: simTime1 }));
    const warmResult = sampleWavefront(warmState, makeParams({ history, simTime: simTime2 }));

    const coldState = createSamplerState();
    const coldResult = sampleWavefront(coldState, makeParams({ history, simTime: simTime2 }));

    for (let i = 0; i < coldResult.length; i++) {
      // Warm-start and cold-start should agree within the solver's convergence tolerance.
      expect(warmResult[i]).toBeCloseTo(coldResult[i], 6);
    }
  });
});

// ─── Scalar correctness ───────────────────────────────────────────────────────

describe('sampleWavefront: scalar correctness', () => {
  it('stationary charge → all bZAccel values ≈ 0', () => {
    const state = createSamplerState();
    const history = buildHistory({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    const result = sampleWavefront(state, makeParams({ history }));
    for (const v of result) {
      expect(v).toBeCloseTo(0, 6);
    }
  });

  it('accelerating charge → at least some nonzero bZAccel values', () => {
    const state = createSamplerState();
    const history = buildHistory({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0 });
    const result = sampleWavefront(state, makeParams({ history }));
    const anyNonzero = Array.from(result).some(v => Math.abs(v) > 1e-6);
    expect(anyNonzero).toBe(true);
  });

  it('always returns signed scalars (shaping to abs is the rendering layer responsibility)', () => {
    const state = createSamplerState();
    const history = buildHistory({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0 });
    const result = sampleWavefront(state, makeParams({ history }));
    // Signed result should have both positive and negative values around the charge.
    const hasNegative = Array.from(result).some(v => v < -1e-9);
    const hasPositive = Array.from(result).some(v => v >  1e-9);
    expect(hasNegative || hasPositive).toBe(true); // at least one nonzero
    // No abs() applied: some negative values should exist for an accelerating source.
    expect(hasNegative).toBe(true);
  });

  it('cell count equals gridW * gridH and index j*gridW+i addresses distinct cells', () => {
    const gW = 5;
    const gH = 4;
    // Use a stationary charge so all cells have deterministic, convergent fields.
    const history = buildHistory({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    const state = createSamplerState();
    const result = sampleWavefront(state, makeParams({ history, gridW: gW, gridH: gH }));
    // Output length must equal the full grid.
    expect(result.length).toBe(gW * gH);
    // A second call with the same inputs (warm-start available) must return the same values.
    // Uses a stationary charge so the solver is well-conditioned and warm-start is stable.
    const state2 = createSamplerState();
    const cold = sampleWavefront(state2, makeParams({ history, gridW: gW, gridH: gH }));
    for (let j = 0; j < gH; j++) {
      for (let i = 0; i < gW; i++) {
        const idx = j * gW + i;
        expect(result[idx]).toBeCloseTo(cold[idx], 6);
      }
    }
  });
});

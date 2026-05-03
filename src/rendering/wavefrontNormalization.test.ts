import { describe, it, expect } from 'vitest';
import { runNormalizationProbe } from './wavefrontNormalization';
import { createSamplerState } from '@/physics/wavefrontSampler';
import { ChargeHistory } from '@/physics/chargeHistory';
import type { ChargeRuntime } from '@/physics/chargeRuntime';
import type { SamplerBounds, SimConfig } from '@/physics/types';

const CONFIG: SimConfig = { c: 1.0, softening: 0.01 };

function buildStaticHistory(
  pos = { x: 0, y: 0 },
  vel = { x: 0, y: 0 },
  tMax = 5,
  dt = 0.05,
): ChargeHistory {
  const h = new ChargeHistory();
  for (let t = 0; t <= tMax; t += dt) {
    h.recordState({
      t,
      pos: { x: pos.x + vel.x * t, y: pos.y + vel.y * t },
      vel,
      accel: { x: 0, y: 0 },
    });
  }
  return h;
}

function makeRuntime(history: ChargeHistory, charge = 1): ChargeRuntime {
  return { history, charge };
}

function makeScratch(gridW: number, gridH: number) {
  const n = gridW * gridH;
  return {
    probeScratch: [
      new Float32Array(n),
      new Float32Array(n),
      new Float32Array(n),
    ],
    probeMask: new Uint8Array(n),
    normSamplerStates: [createSamplerState(), createSamplerState()],
  };
}

describe('runNormalizationProbe', () => {
  it('returns ok:true peaks for a non-singular probe', () => {
    const gridW = 16, gridH = 16;
    const bounds: SamplerBounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 };
    const runtime = makeRuntime(buildStaticHistory({ x: 0, y: 0 }, { x: 0.3, y: 0 }));
    const scratch = makeScratch(gridW, gridH);

    const r = runNormalizationProbe({
      chargeRuntimes: [runtime],
      ...scratch,
      bounds,
      config: CONFIG,
      probeTime: 4.0,
      simEpoch: 0,
      gridW, gridH,
      maskRadiusFactor: 50,  // mask radius = 0.5 world units; small relative to 4×4 view
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.peaks[0]).toBeGreaterThan(0);
      expect(r.peaks[2]).toBeGreaterThan(0); // accel nonzero only with acceleration; vel is the bound part
    }
  });

  it('returns ok:false when every probe cell is inside the mask radius (extreme zoom)', () => {
    const gridW = 8, gridH = 8;
    // Tight zoom centered on a stationary charge: bounds half-width 0.2, mask
    // radius 50 * 0.01 = 0.5 → entire view is inside the mask.
    const bounds: SamplerBounds = { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 };
    const runtime = makeRuntime(buildStaticHistory({ x: 0, y: 0 }));
    const scratch = makeScratch(gridW, gridH);

    const r = runNormalizationProbe({
      chargeRuntimes: [runtime],
      ...scratch,
      bounds,
      config: CONFIG,
      probeTime: 4.0,
      simEpoch: 0,
      gridW, gridH,
      maskRadiusFactor: 50,
    });

    expect(r.ok).toBe(false);
  });

  it('maskRadiusFactor:0 disables masking — peaks computed over every cell', () => {
    const gridW = 8, gridH = 8;
    // Same extreme-zoom geometry as above; with masking disabled, the call
    // must succeed. This is the bootstrap path used by Policy B when every
    // masked phase came back ok:false.
    const bounds: SamplerBounds = { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 };
    const runtime = makeRuntime(buildStaticHistory({ x: 0, y: 0 }));
    const scratch = makeScratch(gridW, gridH);

    const r = runNormalizationProbe({
      chargeRuntimes: [runtime],
      ...scratch,
      bounds,
      config: CONFIG,
      probeTime: 4.0,
      simEpoch: 0,
      gridW, gridH,
      maskRadiusFactor: 0,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      // Mask scratch should remain all-1 since maskRadius collapses to 0.
      for (const v of scratch.probeMask) expect(v).toBe(1);
    }
  });

  it('skips charges with empty histories without erroring', () => {
    const gridW = 8, gridH = 8;
    const bounds: SamplerBounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 };
    const emptyRuntime = makeRuntime(new ChargeHistory());
    const liveRuntime  = makeRuntime(buildStaticHistory({ x: 0, y: 0 }, { x: 0.3, y: 0 }));
    const scratch = makeScratch(gridW, gridH);

    const r = runNormalizationProbe({
      chargeRuntimes: [emptyRuntime, liveRuntime],
      ...scratch,
      bounds,
      config: CONFIG,
      probeTime: 4.0,
      simEpoch: 0,
      gridW, gridH,
      maskRadiusFactor: 50,
    });

    expect(r.ok).toBe(true);
  });
});

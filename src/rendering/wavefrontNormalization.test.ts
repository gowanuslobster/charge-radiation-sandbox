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

// Sinusoidal-x oscillator: x(t) = A·sin(ω·t). Used by tests that need an
// actually-accelerating source so the accel-channel peak is non-trivial
// (i.e. exceeds computeContrastPeak's MIN_CONTRAST_PEAK = 1e-10 floor).
function buildOscillatingHistory(
  amplitude = 0.2,
  omega = 4.0,
  tMax = 5,
  dt = 0.025,
): ChargeHistory {
  const h = new ChargeHistory();
  for (let t = 0; t <= tMax; t += dt) {
    const phase = omega * t;
    h.recordState({
      t,
      pos:   { x: amplitude * Math.sin(phase),                    y: 0 },
      vel:   { x: amplitude * omega * Math.cos(phase),            y: 0 },
      accel: { x: -amplitude * omega * omega * Math.sin(phase),   y: 0 },
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
    // Oscillating fixture so the accel-channel peak is genuinely non-trivial.
    // (A constant-velocity fixture would only assert peaks[2] > 0 by floor:
    // computeContrastPeak's MIN_CONTRAST_PEAK = 1e-10 makes that test pass
    // even on a zero scalar buffer.)
    const runtime = makeRuntime(buildOscillatingHistory());
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
      expect(r.peaks[0]).toBeGreaterThan(1e-6); // total — well above the 1e-10 floor
      expect(r.peaks[1]).toBeGreaterThan(1e-6); // vel — bound near-field, finite off-axis
      expect(r.peaks[2]).toBeGreaterThan(1e-6); // accel — radiative, requires acceleration
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

  it('handles a 7-runtime fixture (Particle Beam scale) without erroring', () => {
    // M13-A scale: seven uniformly-translating positive charges in a line.
    // The probe must aggregate all seven contributions into the per-channel
    // scratch buffers and return a valid peak.
    const gridW = 16, gridH = 16;
    const bounds: SamplerBounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 };
    const N = 7;
    const spacing = 0.4;
    const offset0 = -((N - 1) / 2) * spacing;
    const runtimes: ChargeRuntime[] = [];
    for (let i = 0; i < N; i++) {
      const x0 = offset0 + i * spacing;
      runtimes.push(makeRuntime(buildStaticHistory({ x: x0, y: 0 }, { x: 0.6, y: 0 })));
    }
    const scratch = {
      probeScratch: [
        new Float32Array(gridW * gridH),
        new Float32Array(gridW * gridH),
        new Float32Array(gridW * gridH),
      ],
      probeMask: new Uint8Array(gridW * gridH),
      // One sampler state per runtime — must have length ≥ runtimes.length.
      normSamplerStates: Array.from({ length: N }, () => createSamplerState()),
    };

    const r = runNormalizationProbe({
      chargeRuntimes: runtimes,
      ...scratch,
      bounds,
      config: CONFIG,
      probeTime: 4.0,
      simEpoch: 0,
      gridW, gridH,
      maskRadiusFactor: 50,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.peaks[0]).toBeGreaterThan(0); // total
      expect(r.peaks[1]).toBeGreaterThan(0); // velocity-field component is bound; nonzero off-axis
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

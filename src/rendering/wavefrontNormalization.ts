// wavefrontNormalization — shared masked-probe helper for the magnetic-field overlay.
//
// Both WavefrontWebGLCanvas and WavefrontOverlayCanvas need to estimate a
// per-channel contrast peak each frame so the heatmap normalization is stable.
// The estimate comes from a coarse probe of the LW magnetic field on a small
// grid, with cells inside MASK_RADIUS_FACTOR · softening of any charge's
// position at probeTime excluded — this keeps the bound 1/R^2 near-source
// peak from anchoring the display scale.
//
// The probe logic is identical between the two canvases. This module hosts the
// single definition so future tuning (mask radius, fallback policy, weighting)
// stays in lockstep across the WebGL and CPU paths.
//
// Sentinel: when the mask excludes every cell (only happens at extreme zoom
// where the entire visible region falls inside one mask circle), this returns
// `{ ok: false }`. The caller decides what to do — Policy A reuses the
// previous EMA value; Policy B retries the helper at maskRadiusFactor=0 as a
// bootstrap so the first frame after invalidation is not black or saturated.

import type { ChargeRuntime } from '@/physics/chargeRuntime';
import type { SimConfig, SamplerBounds } from '@/physics/types';
import {
  sampleWavefront,
  type WavefrontSamplerState,
} from '@/physics/wavefrontSampler';
import { computeContrastPeak } from './wavefrontRender';

export type NormalizationProbeResult =
  | { ok: true;  peaks: [number, number, number] }
  | { ok: false };

export interface NormalizationProbeOptions {
  chargeRuntimes: ChargeRuntime[];
  /** Sampler scratch states, one per charge slot. Length must be ≥ chargeRuntimes.length. */
  normSamplerStates: WavefrontSamplerState[];
  /**
   * Per-channel scratch buffers, ordered [total, vel, accel]. Each must have
   * length gridW * gridH. Cleared and overwritten by this call.
   */
  probeScratch: Float32Array[];
  /** Mask scratch, length gridW * gridH. Reset to all-1, then 0s written near each charge. */
  probeMask: Uint8Array;
  bounds: SamplerBounds;
  config: SimConfig;
  probeTime: number;
  simEpoch: number;
  gridW: number;
  gridH: number;
  /**
   * Mask radius = factor · (config.softening ?? 0.01). Pass 0 to disable
   * masking entirely (used by the Policy B bootstrap after every phase came
   * back fully masked).
   */
  maskRadiusFactor: number;
}

export function runNormalizationProbe(
  opts: NormalizationProbeOptions,
): NormalizationProbeResult {
  const {
    chargeRuntimes, normSamplerStates,
    probeScratch, probeMask,
    bounds, config, probeTime, simEpoch,
    gridW, gridH, maskRadiusFactor,
  } = opts;

  probeScratch[0].fill(0);
  probeScratch[1].fill(0);
  probeScratch[2].fill(0);
  probeMask.fill(1);

  const maskRadius   = maskRadiusFactor * (config.softening ?? 0.01);
  const maskRadiusSq = maskRadius * maskRadius;
  const dxCell = gridW > 1 ? (bounds.maxX - bounds.minX) / (gridW - 1) : 0;
  const dyCell = gridH > 1 ? (bounds.maxY - bounds.minY) / (gridH - 1) : 0;

  const total = probeScratch[0];
  const vel   = probeScratch[1];
  const accel = probeScratch[2];

  for (let ci = 0; ci < chargeRuntimes.length; ci++) {
    const { history: h, charge: q } = chargeRuntimes[ci];
    if (!h || h.isEmpty()) continue;

    const samples = sampleWavefront(normSamplerStates[ci], {
      history: h,
      simTime: probeTime,
      charge:  q,
      config,
      bounds,
      gridW,
      gridH,
      simEpoch,
    });

    for (let k = 0; k < total.length; k++) {
      total[k] += samples.bZ[k];
      vel[k]   += samples.bZVel[k];
      accel[k] += samples.bZAccel[k];
    }

    if (maskRadius > 0 && dxCell > 0 && dyCell > 0) {
      const s = h.interpolateAt(probeTime);
      const iMin = Math.max(0,         Math.floor((s.pos.x - maskRadius - bounds.minX) / dxCell));
      const iMax = Math.min(gridW - 1, Math.ceil ((s.pos.x + maskRadius - bounds.minX) / dxCell));
      const jMin = Math.max(0,         Math.floor((s.pos.y - maskRadius - bounds.minY) / dyCell));
      const jMax = Math.min(gridH - 1, Math.ceil ((s.pos.y + maskRadius - bounds.minY) / dyCell));
      for (let j = jMin; j <= jMax; j++) {
        const cellY = bounds.minY + j * dyCell;
        const ddy   = cellY - s.pos.y;
        const ddySq = ddy * ddy;
        for (let i = iMin; i <= iMax; i++) {
          const cellX = bounds.minX + i * dxCell;
          const ddx   = cellX - s.pos.x;
          if (ddx * ddx + ddySq < maskRadiusSq) {
            probeMask[j * gridW + i] = 0;
          }
        }
      }
    }
  }

  const totalPeak = computeContrastPeak(total, 'signed', probeMask);
  if (totalPeak < 0) return { ok: false };
  const velPeak   = computeContrastPeak(vel,   'signed', probeMask);
  const accelPeak = computeContrastPeak(accel, 'signed', probeMask);
  return { ok: true, peaks: [totalPeak, velPeak, accelPeak] };
}

// Probe channel selection for the field probe overlay.
//
// A probe samples a single LWFieldResult at one observation point and projects
// it down to a scalar for the time-series chart and instantaneous readout.
// This module owns the channel enumeration and the projection helper so that
// every consumer (hook, panel, tests) agrees on the mapping.
//
// Poynting projection: in 2D with E in-plane and B = (0, 0, Bz),
//   Sx =  Ey · Bz,   Sy = -Ex · Bz,   |S| = sqrt(Sx² + Sy²)
// (instantaneous and in sandbox units; not SI-calibrated).

import type { LWFieldResult } from './types';

export type ProbeChannel = 'Ex' | 'Ey' | 'Emag' | 'Bz' | 'Sx' | 'Sy' | 'Smag';

export const PROBE_CHANNELS: readonly ProbeChannel[] = [
  'Ex',
  'Ey',
  'Emag',
  'Bz',
  'Sx',
  'Sy',
  'Smag',
];

export const DEFAULT_PROBE_CHANNEL: ProbeChannel = 'Bz';

/**
 * Project a full Liénard-Wiechert field result down to the scalar selected
 * by `channel`. `Emag` and `Smag` are the only unsigned channels; the rest
 * preserve sign.
 */
export function getProbeChannelValue(
  result: LWFieldResult,
  channel: ProbeChannel,
): number {
  switch (channel) {
    case 'Ex':
      return result.eTotal.x;
    case 'Ey':
      return result.eTotal.y;
    case 'Emag':
      return Math.hypot(result.eTotal.x, result.eTotal.y);
    case 'Bz':
      return result.bZ;
    case 'Sx':
      return result.eTotal.y * result.bZ;
    case 'Sy':
      return -result.eTotal.x * result.bZ;
    case 'Smag': {
      const sx =  result.eTotal.y * result.bZ;
      const sy = -result.eTotal.x * result.bZ;
      return Math.hypot(sx, sy);
    }
  }
}

// Probe channel selection for the field probe overlay.
//
// A probe samples a single LWFieldResult at one observation point and projects
// it down to a scalar for the time-series chart and instantaneous readout.
// This module owns the channel enumeration and the projection helper so that
// every consumer (hook, panel, tests) agrees on the mapping.

import type { LWFieldResult } from './types';

export type ProbeChannel = 'Ex' | 'Ey' | 'Emag' | 'Bz' | 'BzVel' | 'BzAccel';

export const PROBE_CHANNELS: readonly ProbeChannel[] = [
  'Ex',
  'Ey',
  'Emag',
  'Bz',
  'BzVel',
  'BzAccel',
];

export const DEFAULT_PROBE_CHANNEL: ProbeChannel = 'Bz';

/**
 * Project a full Liénard-Wiechert field result down to the scalar selected
 * by `channel`. `Emag` is the only unsigned channel; the rest preserve sign.
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
    case 'BzVel':
      return result.bZVel;
    case 'BzAccel':
      return result.bZAccel;
  }
}

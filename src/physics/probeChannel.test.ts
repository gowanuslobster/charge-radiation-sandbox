import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROBE_CHANNEL,
  PROBE_CHANNELS,
  getProbeChannelValue,
  type ProbeChannel,
} from './probeChannel';
import type { LWFieldResult } from './types';

const sample: LWFieldResult = {
  eVel: { x: 1, y: 2 },
  eAccel: { x: -3, y: 4 },
  eTotal: { x: -2, y: 6 },
  bZ: 0.5,
  bZVel: 0.2,
  bZAccel: 0.3,
};

describe('getProbeChannelValue', () => {
  it('projects Ex from eTotal.x', () => {
    expect(getProbeChannelValue(sample, 'Ex')).toBe(-2);
  });

  it('projects Ey from eTotal.y', () => {
    expect(getProbeChannelValue(sample, 'Ey')).toBe(6);
  });

  it('projects Emag as |eTotal|', () => {
    expect(getProbeChannelValue(sample, 'Emag')).toBeCloseTo(Math.hypot(-2, 6), 12);
  });

  it('projects Bz, BzVel, BzAccel directly', () => {
    expect(getProbeChannelValue(sample, 'Bz')).toBe(0.5);
    expect(getProbeChannelValue(sample, 'BzVel')).toBe(0.2);
    expect(getProbeChannelValue(sample, 'BzAccel')).toBe(0.3);
  });

  it('preserves sign for signed channels', () => {
    const negative: LWFieldResult = {
      ...sample,
      eTotal: { x: -1, y: -1 },
      bZ: -0.7,
      bZVel: -0.4,
      bZAccel: -0.3,
    };
    expect(getProbeChannelValue(negative, 'Ex')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'Ey')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'Bz')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'BzVel')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'BzAccel')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'Emag')).toBeGreaterThanOrEqual(0);
  });
});

describe('PROBE_CHANNELS', () => {
  it('lists all six channels with no duplicates', () => {
    expect(PROBE_CHANNELS).toEqual(['Ex', 'Ey', 'Emag', 'Bz', 'BzVel', 'BzAccel']);
    expect(new Set(PROBE_CHANNELS).size).toBe(PROBE_CHANNELS.length);
  });

  it('includes the default channel', () => {
    expect(PROBE_CHANNELS).toContain(DEFAULT_PROBE_CHANNEL);
  });

  it('is exhaustive — every channel projects to a finite number', () => {
    for (const ch of PROBE_CHANNELS as readonly ProbeChannel[]) {
      const v = getProbeChannelValue(sample, ch);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

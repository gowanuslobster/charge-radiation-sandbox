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

  it('projects Bz directly', () => {
    expect(getProbeChannelValue(sample, 'Bz')).toBe(0.5);
  });

  it('projects Sx as Ey * Bz', () => {
    expect(getProbeChannelValue(sample, 'Sx')).toBeCloseTo(6 * 0.5, 12);
  });

  it('projects Sy as -Ex * Bz', () => {
    expect(getProbeChannelValue(sample, 'Sy')).toBeCloseTo(-(-2) * 0.5, 12);
  });

  it('projects Smag as hypot(Sx, Sy)', () => {
    const sx =  6 * 0.5;
    const sy = -(-2) * 0.5;
    expect(getProbeChannelValue(sample, 'Smag')).toBeCloseTo(Math.hypot(sx, sy), 12);
  });

  it('preserves sign for signed channels', () => {
    const negative: LWFieldResult = {
      ...sample,
      eTotal: { x: -1, y: -1 },
      bZ: -0.7,
    };
    expect(getProbeChannelValue(negative, 'Ex')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'Ey')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'Bz')).toBeLessThan(0);
    // Sx = Ey * Bz = (-1)*(-0.7) = +0.7
    expect(getProbeChannelValue(negative, 'Sx')).toBeGreaterThan(0);
    // Sy = -Ex * Bz = -(-1)*(-0.7) = -0.7
    expect(getProbeChannelValue(negative, 'Sy')).toBeLessThan(0);
    expect(getProbeChannelValue(negative, 'Emag')).toBeGreaterThanOrEqual(0);
    expect(getProbeChannelValue(negative, 'Smag')).toBeGreaterThanOrEqual(0);
  });

  it('Smag equals sqrt(Sx^2 + Sy^2) on arbitrary inputs', () => {
    const r: LWFieldResult = {
      ...sample,
      eTotal: { x: 0.4, y: -1.3 },
      bZ: 1.7,
    };
    const sx = getProbeChannelValue(r, 'Sx');
    const sy = getProbeChannelValue(r, 'Sy');
    const sm = getProbeChannelValue(r, 'Smag');
    expect(sm).toBeCloseTo(Math.hypot(sx, sy), 12);
  });
});

describe('PROBE_CHANNELS', () => {
  it('lists exactly the seven channels with no duplicates', () => {
    expect(PROBE_CHANNELS).toEqual(['Ex', 'Ey', 'Emag', 'Bz', 'Sx', 'Sy', 'Smag']);
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

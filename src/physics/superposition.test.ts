// superposition.test.ts — M10 multi-charge architecture tests.
//
// Four tests:
//   1. evaluateSuperposedLienardWiechertField returns sum of individual fields.
//   2. Dipole charges are out of phase: charge 0 accel.x = -charge 1 accel.x.
//   3. Dipole initial positions are correct (at ±sep/2, separation > 2A).
//   4. sampleDemoChargeStates('dipole', t) returns two entries with charges +1 and -1.
//   5. Hydrogen mode has a fixed positive center and orbiting negative charge.

import { describe, it, expect } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import { evaluateLienardWiechertField, evaluateSuperposedLienardWiechertField } from './lienardWiechert';
import {
  sampleDemoChargeStates,
  DIPOLE_SEPARATION,
  DIPOLE_AMPLITUDE,
  HYDROGEN_ORBIT_RADIUS,
  HYDROGEN_OMEGA,
} from './demoModes';
import type { ChargeRuntime } from './chargeRuntime';
import type { SimConfig } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSingleChargeHistory(_charge: number, pos: { x: number; y: number }): ChargeHistory {
  const h = new ChargeHistory();
  // Seed a few past states so the retarded-time solver has something to work with.
  for (let i = -5; i <= 0; i++) {
    h.recordState({ t: i * 0.1, pos, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } });
  }
  return h;
}

const DEFAULT_CONFIG: SimConfig = { c: 1.0, softening: 0.01 };

// ── Test 1: superposition equals sum of individual fields ─────────────────────

describe('evaluateSuperposedLienardWiechertField', () => {
  it('returns the sum of individual single-charge fields', () => {
    const pos0 = { x: -0.5, y: 0 };
    const pos1 = { x:  0.5, y: 0 };
    const h0 = makeSingleChargeHistory(+1, pos0);
    const h1 = makeSingleChargeHistory(-1, pos1);

    const runtimes: ChargeRuntime[] = [
      { history: h0, charge: +1 },
      { history: h1, charge: -1 },
    ];

    const observationPos = { x: 0, y: 2 };
    const observationTime = 0;
    const config = DEFAULT_CONFIG;

    // Superposed result.
    const superposed = evaluateSuperposedLienardWiechertField({
      observationPos,
      observationTime,
      chargeRuntimes: runtimes,
      config,
    });
    expect(superposed).not.toBeNull();

    // Individual results.
    const r0 = evaluateLienardWiechertField({
      observationPos, observationTime, history: h0, charge: +1, config,
    });
    const r1 = evaluateLienardWiechertField({
      observationPos, observationTime, history: h1, charge: -1, config,
    });
    expect(r0).not.toBeNull();
    expect(r1).not.toBeNull();

    expect(superposed!.eTotal.x).toBeCloseTo(r0!.eTotal.x + r1!.eTotal.x, 10);
    expect(superposed!.eTotal.y).toBeCloseTo(r0!.eTotal.y + r1!.eTotal.y, 10);
    expect(Math.abs(superposed!.bZ - (r0!.bZ + r1!.bZ))).toBeLessThan(1e-10);
  });

  it('returns partial sum when one charge history is empty (null result skipped)', () => {
    const emptyHistory = new ChargeHistory(); // empty — solver returns null
    const pos1 = { x: 0, y: 0 };
    const h1 = makeSingleChargeHistory(+1, pos1);

    const runtimes: ChargeRuntime[] = [
      { history: emptyHistory, charge: +1 },
      { history: h1,           charge: +1 },
    ];

    const result = evaluateSuperposedLienardWiechertField({
      observationPos:  { x: 0, y: 2 },
      observationTime: 0,
      chargeRuntimes:  runtimes,
      config:          DEFAULT_CONFIG,
    });
    // Should not be null — one charge returned a result.
    expect(result).not.toBeNull();
  });

  it('returns null when all histories are empty', () => {
    const runtimes: ChargeRuntime[] = [
      { history: new ChargeHistory(), charge: +1 },
      { history: new ChargeHistory(), charge: -1 },
    ];
    const result = evaluateSuperposedLienardWiechertField({
      observationPos:  { x: 0, y: 2 },
      observationTime: 0,
      chargeRuntimes:  runtimes,
      config:          DEFAULT_CONFIG,
    });
    expect(result).toBeNull();
  });
});

// ── Test 2: dipole charges are out of phase ───────────────────────────────────

describe('sampleDemoChargeStates dipole kinematics', () => {
  it('charge 0 accel.x equals negative of charge 1 accel.x at all times', () => {
    for (const t of [0, 0.5, 1.0, Math.PI / 4]) {
      const specs = sampleDemoChargeStates('dipole', t);
      expect(specs).toHaveLength(2);
      expect(specs[0].state.accel.x).toBeCloseTo(-specs[1].state.accel.x, 10);
      // y components are zero for collinear dipole.
      expect(specs[0].state.accel.y).toBe(0);
      expect(specs[1].state.accel.y).toBe(0);
    }
  });

  // ── Test 3: dipole initial positions ─────────────────────────────────────────

  it('initial positions are at ±DIPOLE_SEPARATION/2 with separation > 2×DIPOLE_AMPLITUDE', () => {
    const specs = sampleDemoChargeStates('dipole', 0);
    expect(specs).toHaveLength(2);

    const half = DIPOLE_SEPARATION / 2;
    // At t=0: sin(0) = 0, so positions are exactly at ±half.
    expect(specs[0].state.pos.x).toBeCloseTo(+half, 10);
    expect(specs[1].state.pos.x).toBeCloseTo(-half, 10);
    expect(specs[0].state.pos.y).toBe(0);
    expect(specs[1].state.pos.y).toBe(0);

    // Separation invariant: charges never cross (DIPOLE_SEPARATION > 2 × DIPOLE_AMPLITUDE).
    expect(DIPOLE_SEPARATION).toBeGreaterThan(2 * DIPOLE_AMPLITUDE);
  });

  // ── Test 4: correct charge signs ─────────────────────────────────────────────

  it('returns charges +1 and -1', () => {
    const specs = sampleDemoChargeStates('dipole', 0);
    expect(specs).toHaveLength(2);
    expect(specs[0].charge).toBe(+1);
    expect(specs[1].charge).toBe(-1);
  });
});

// ── Test 5: hydrogen-like circular orbit ──────────────────────────────────────

describe('sampleDemoChargeStates hydrogen kinematics', () => {
  it('returns fixed positive center and orbiting negative charge', () => {
    const specs = sampleDemoChargeStates('hydrogen', 0);
    expect(specs).toHaveLength(2);
    expect(specs[0].charge).toBe(+1);
    expect(specs[1].charge).toBe(-1);

    expect(specs[0].state.pos.x).toBe(0);
    expect(specs[0].state.pos.y).toBe(0);
    expect(specs[0].state.vel.x).toBe(0);
    expect(specs[0].state.vel.y).toBe(0);
    expect(specs[0].state.accel.x).toBe(0);
    expect(specs[0].state.accel.y).toBe(0);

    expect(specs[1].state.pos.x).toBeCloseTo(HYDROGEN_ORBIT_RADIUS, 10);
    expect(specs[1].state.pos.y).toBeCloseTo(0, 10);
    expect(specs[1].state.vel.x).toBeCloseTo(0, 10);
    expect(specs[1].state.vel.y).toBeCloseTo(HYDROGEN_ORBIT_RADIUS * HYDROGEN_OMEGA, 10);
    expect(specs[1].state.accel.x).toBeCloseTo(-HYDROGEN_ORBIT_RADIUS * HYDROGEN_OMEGA ** 2, 10);
    expect(specs[1].state.accel.y).toBeCloseTo(0, 10);
  });

  it('keeps the orbit radius constant', () => {
    for (const t of [0, 0.25, 1.0, Math.PI]) {
      const electron = sampleDemoChargeStates('hydrogen', t)[1].state;
      const r = Math.hypot(electron.pos.x, electron.pos.y);
      const v = Math.hypot(electron.vel.x, electron.vel.y);
      expect(r).toBeCloseTo(HYDROGEN_ORBIT_RADIUS, 10);
      expect(v).toBeCloseTo(HYDROGEN_ORBIT_RADIUS * HYDROGEN_OMEGA, 10);
    }
  });
});

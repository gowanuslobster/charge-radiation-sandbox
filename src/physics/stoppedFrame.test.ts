import { describe, it, expect } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import type { ChargeRuntime } from './chargeRuntime';
import type { SamplerBounds, SimConfig } from './types';
import {
  SUDDEN_STOP_T_BRAKE,
  SUDDEN_STOP_BRAKE_SUBSTEP_DT,
  WATER_O_CHARGE,
  WATER_H_CHARGE,
  sampleStoppedDemoChargeStates,
} from './demoModes';
import { recordStoppedFrame } from './stoppedFrame';

// Helpers to build fresh ChargeRuntime arrays for each test, since
// recordStoppedFrame mutates history.
function freshRuntimes(charges: number[]): ChargeRuntime[] {
  return charges.map(charge => ({ history: new ChargeHistory(), charge }));
}

// Generous bounds so the per-charge horizon never prunes the recorded entries
// during these focused tests.
const BOUNDS: SamplerBounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 };
const CONFIG: SimConfig = { c: 1.0, softening: 0.01 };

describe('recordStoppedFrame: substep + current recording', () => {
  const T_trig = 0.5;
  const TB = SUDDEN_STOP_T_BRAKE;
  const brakeEnd = T_trig + TB;

  it('records boundary anchor at T_trig when frame straddles trigger', () => {
    // Frame: prev=0.45, curr=0.55 — straddles T_trig=0.5.
    const runtimes = freshRuntimes([1]);
    recordStoppedFrame(runtimes, 'moving_charge', 0.45, 0.55, T_trig, BOUNDS, CONFIG);
    const history = runtimes[0].history;
    const times: number[] = [];
    for (let i = 0; i < history.count; i++) times.push(history.stateAt(i).t);
    expect(times).toContain(T_trig);
    // Last entry is the current sample.
    expect(times[times.length - 1]).toBeCloseTo(0.55, 12);
  });

  it('records boundary anchor at brakeEnd when frame straddles brake completion', () => {
    // Frame: prev=brakeEnd-0.05, curr=brakeEnd+0.05.
    const runtimes = freshRuntimes([1]);
    recordStoppedFrame(runtimes, 'moving_charge', brakeEnd - 0.05, brakeEnd + 0.05, T_trig, BOUNDS, CONFIG);
    const history = runtimes[0].history;
    const times: number[] = [];
    for (let i = 0; i < history.count; i++) times.push(history.stateAt(i).t);
    expect(times.some(t => Math.abs(t - brakeEnd) < 1e-9)).toBe(true);
  });

  it('substep timestamps fall in the closed interval [T_trig, brakeEnd]', () => {
    // Single huge frame that spans the entire brake window — every substep
    // brakingSubstepTimes can return should land here.
    const runtimes = freshRuntimes([1]);
    recordStoppedFrame(runtimes, 'moving_charge', T_trig - 0.05, brakeEnd + 0.05, T_trig, BOUNDS, CONFIG);
    const history = runtimes[0].history;
    for (let i = 0; i < history.count - 1; i++) {
      const t = history.stateAt(i).t;
      expect(t).toBeGreaterThanOrEqual(T_trig - 1e-9);
      expect(t).toBeLessThanOrEqual(brakeEnd + 1e-9);
    }
  });

  it('interior substeps record brake-phase state from the sampler', () => {
    const runtimes = freshRuntimes([1]);
    recordStoppedFrame(runtimes, 'moving_charge', T_trig - 0.05, brakeEnd + 0.05, T_trig, BOUNDS, CONFIG);
    const history = runtimes[0].history;
    for (let i = 0; i < history.count; i++) {
      const rec = history.stateAt(i);
      // Interior substep == strictly inside (T_trig, brakeEnd).
      if (rec.t > T_trig + 1e-9 && rec.t < brakeEnd - 1e-9) {
        const expected = sampleStoppedDemoChargeStates('moving_charge', rec.t, T_trig)[0].state;
        expect(rec.pos.x).toBeCloseTo(expected.pos.x, 10);
        expect(rec.vel.x).toBeCloseTo(expected.vel.x, 10);
        expect(rec.accel.x).toBeCloseTo(expected.accel.x, 10);
      }
    }
  });

  it('brakeEnd anchor records the sampler\'s rest-phase value (exclusive-right convention)', () => {
    const runtimes = freshRuntimes([1]);
    recordStoppedFrame(runtimes, 'moving_charge', brakeEnd - 0.05, brakeEnd + 0.05, T_trig, BOUNDS, CONFIG);
    const history = runtimes[0].history;
    let foundAnchor = false;
    for (let i = 0; i < history.count; i++) {
      const rec = history.stateAt(i);
      if (Math.abs(rec.t - brakeEnd) < 1e-9) {
        foundAnchor = true;
        const expected = sampleStoppedDemoChargeStates('moving_charge', brakeEnd, T_trig)[0].state;
        expect(rec.pos.x).toBeCloseTo(expected.pos.x, 12);
        // Rest-phase: vel and accel are exactly zero.
        expect(rec.vel.x).toBe(0); expect(rec.vel.y).toBe(0);
        expect(rec.accel.x).toBe(0); expect(rec.accel.y).toBe(0);
      }
    }
    expect(foundAnchor).toBe(true);
  });

  it('interior substep spacing ≤ SUDDEN_STOP_BRAKE_SUBSTEP_DT', () => {
    // Span enough of the brake window that brakingSubstepTimes emits interior substeps.
    const runtimes = freshRuntimes([1]);
    recordStoppedFrame(runtimes, 'moving_charge', T_trig - 0.05, brakeEnd + 0.05, T_trig, BOUNDS, CONFIG);
    const history = runtimes[0].history;
    const times: number[] = [];
    for (let i = 0; i < history.count; i++) times.push(history.stateAt(i).t);
    // Filter to records strictly inside the brake interval (boundaries
    // included as anchors).
    const inBrake = times.filter(t => t >= T_trig - 1e-9 && t <= brakeEnd + 1e-9);
    // Adjacent gaps must not exceed SUDDEN_STOP_BRAKE_SUBSTEP_DT.
    for (let i = 1; i < inBrake.length; i++) {
      expect(inBrake[i] - inBrake[i - 1]).toBeLessThanOrEqual(SUDDEN_STOP_BRAKE_SUBSTEP_DT + 1e-9);
    }
  });
});

describe('recordStoppedFrame: post-trigger purely-rest frames record only the current sample', () => {
  const T_trig = 0.5;
  const TB = SUDDEN_STOP_T_BRAKE;
  const brakeEnd = T_trig + TB;

  it('no substeps when both prev and curr are past brakeEnd', () => {
    const runtimes = freshRuntimes([1]);
    recordStoppedFrame(runtimes, 'moving_charge', brakeEnd + 0.5, brakeEnd + 0.55, T_trig, BOUNDS, CONFIG);
    expect(runtimes[0].history.count).toBe(1);
    const only = runtimes[0].history.stateAt(0);
    expect(only.t).toBeCloseTo(brakeEnd + 0.55, 12);
    // Rest state.
    expect(only.vel.x).toBe(0); expect(only.vel.y).toBe(0);
    expect(only.accel.x).toBe(0); expect(only.accel.y).toBe(0);
  });
});

describe('recordStoppedFrame: multi-charge modes', () => {
  // Dipole and water exercise the per-charge loop. Use water_stretch for
  // the 3-charge case.
  const T_trig = 0.4;

  it('dipole: both charges get the current sample plus any straddling anchors', () => {
    const runtimes = freshRuntimes([+1, -1]);
    recordStoppedFrame(runtimes, 'dipole', T_trig - 0.05, T_trig + 0.05, T_trig, BOUNDS, CONFIG);
    expect(runtimes[0].history.count).toBe(runtimes[1].history.count);
    expect(runtimes[0].history.count).toBeGreaterThan(1);
    // Last entry per charge matches the sampler at current time.
    const expected = sampleStoppedDemoChargeStates('dipole', T_trig + 0.05, T_trig);
    for (let ci = 0; ci < 2; ci++) {
      const last = runtimes[ci].history.stateAt(runtimes[ci].history.count - 1);
      expect(last.pos.x).toBeCloseTo(expected[ci].state.pos.x, 10);
      expect(last.vel.x).toBeCloseTo(expected[ci].state.vel.x, 10);
    }
  });

  it('water_stretch: all three charges share identical timestamps in history', () => {
    const runtimes = freshRuntimes([WATER_O_CHARGE, WATER_H_CHARGE, WATER_H_CHARGE]);
    recordStoppedFrame(runtimes, 'water_stretch', T_trig - 0.05, T_trig + SUDDEN_STOP_T_BRAKE + 0.05, T_trig, BOUNDS, CONFIG);
    const len = runtimes[0].history.count;
    expect(runtimes[1].history.count).toBe(len);
    expect(runtimes[2].history.count).toBe(len);
    for (let i = 0; i < len; i++) {
      const t0 = runtimes[0].history.stateAt(i).t;
      const t1 = runtimes[1].history.stateAt(i).t;
      const t2 = runtimes[2].history.stateAt(i).t;
      expect(t1).toBeCloseTo(t0, 12);
      expect(t2).toBeCloseTo(t0, 12);
    }
  });

  it('hydrogen: charge 0 stays at origin in every recorded sample', () => {
    const runtimes = freshRuntimes([+1, -1]);
    recordStoppedFrame(runtimes, 'hydrogen', T_trig - 0.05, T_trig + 0.05, T_trig, BOUNDS, CONFIG);
    for (let i = 0; i < runtimes[0].history.count; i++) {
      const s = runtimes[0].history.stateAt(i);
      expect(s.pos.x).toBe(0); expect(s.pos.y).toBe(0);
      expect(s.vel.x).toBe(0); expect(s.vel.y).toBe(0);
    }
  });
});

describe('recordStoppedFrame: history window uses pre-stop peak speed', () => {
  // After a stop, maxHistorySpeed(mode) should still return the pre-stop peak,
  // ensuring the buffer keeps enough pre-trigger history for outside-shell
  // observers. Smoke check: setMaxHistoryTime is invoked with a positive,
  // finite value (history is not pruned to empty).
  it('moving_charge: history retains pre-trigger entries past brakeEnd', () => {
    const T_trig = 0.5;
    const runtimes = freshRuntimes([1]);
    // Pre-populate with a long-tailed pre-trigger history.
    for (let t = -3; t <= T_trig - 0.001; t += 0.05) {
      runtimes[0].history.recordState({
        t, pos: { x: 0.6 * t, y: 0 }, vel: { x: 0.6, y: 0 }, accel: { x: 0, y: 0 },
      });
    }
    const prevCount = runtimes[0].history.count;
    // One stop-aware tick well past brake end.
    recordStoppedFrame(runtimes, 'moving_charge', T_trig + SUDDEN_STOP_T_BRAKE + 0.5, T_trig + SUDDEN_STOP_T_BRAKE + 0.55, T_trig, BOUNDS, CONFIG);
    // History should still hold pre-trigger entries (the horizon is wide).
    expect(runtimes[0].history.count).toBeGreaterThan(prevCount);
    // Oldest entry should still be from the pre-trigger window.
    const oldest = runtimes[0].history.oldest();
    expect(oldest).not.toBeNull();
    expect(oldest!.t).toBeLessThan(T_trig);
  });
});

import { describe, it, expect } from 'vitest';
import {
  sampleSourceState,
  sampleSuddenStopState,
  maxHistorySpeed,
  brakingSubstepTimes,
  SUDDEN_STOP_V,
  SUDDEN_STOP_T_STOP,
  SUDDEN_STOP_T_BRAKE,
  SUDDEN_STOP_BRAKE_SUBSTEP_DT,
  SUDDEN_STOP_X_STOP,
  OSCILLATING_AMPLITUDE,
  OSCILLATING_OMEGA,
} from './demoModes';
import { ChargeHistory } from './chargeHistory';
import { evaluateLienardWiechertField } from './lienardWiechert';

// ─── sampleSourceState ────────────────────────────────────────────────────────

describe('sampleSourceState: uniform_velocity', () => {
  it('pos=(0.6t,0), vel=(0.6,0), accel=(0,0) for t = −2, 0, 1', () => {
    for (const t of [-2, 0, 1]) {
      const s = sampleSourceState('uniform_velocity', t);
      expect(s.pos.x).toBeCloseTo(SUDDEN_STOP_V * t);
      expect(s.pos.y).toBe(0);
      expect(s.vel.x).toBeCloseTo(SUDDEN_STOP_V);
      expect(s.vel.y).toBe(0);
      expect(s.accel.x).toBe(0);
      expect(s.accel.y).toBe(0);
    }
  });
});

describe('sampleSourceState: sudden_stop', () => {
  const T0 = SUDDEN_STOP_T_STOP;
  const TB = SUDDEN_STOP_T_BRAKE;

  it('moving phase (t < T_STOP) matches uniform_velocity', () => {
    for (const t of [-5, 0, 1, T0 - 0.001]) {
      const ss = sampleSourceState('sudden_stop', t);
      const uv = sampleSourceState('uniform_velocity', t);
      expect(ss.pos.x).toBeCloseTo(uv.pos.x, 9);
      expect(ss.vel.x).toBeCloseTo(uv.vel.x, 9);
      expect(ss.accel.x).toBe(0);
    }
  });

  it('braking phase: accel.x = −V/T_BRAKE throughout', () => {
    const expectedAccel = -SUDDEN_STOP_V / TB;
    for (const t of [T0, T0 + 0.05, T0 + 0.1, T0 + TB - 0.001]) {
      const s = sampleSourceState('sudden_stop', t);
      expect(s.accel.x).toBeCloseTo(expectedAccel, 9);
      expect(s.accel.y).toBe(0);
    }
  });

  it('braking phase: vel.x = V at T_STOP, 0 at T_STOP+T_BRAKE', () => {
    expect(sampleSourceState('sudden_stop', T0).vel.x).toBeCloseTo(SUDDEN_STOP_V, 9);
    expect(sampleSourceState('sudden_stop', T0 + TB).vel.x).toBeCloseTo(0, 9);
  });

  it('braking phase: vel.x strictly decreasing', () => {
    const times = [T0, T0 + 0.05, T0 + 0.1, T0 + 0.15, T0 + TB];
    for (let i = 1; i < times.length; i++) {
      const prev = sampleSourceState('sudden_stop', times[i - 1]);
      const curr = sampleSourceState('sudden_stop', times[i]);
      expect(curr.vel.x).toBeLessThan(prev.vel.x);
    }
  });

  it('stopped phase: vel=(0,0), accel=(0,0), pos.x = X_STOP', () => {
    for (const t of [T0 + TB, T0 + TB + 0.5, T0 + TB + 2]) {
      const s = sampleSourceState('sudden_stop', t);
      expect(s.vel.x).toBeCloseTo(0, 9);
      expect(s.vel.y).toBe(0);
      expect(s.accel.x).toBeCloseTo(0, 9);
      expect(s.accel.y).toBe(0);
      expect(s.pos.x).toBeCloseTo(SUDDEN_STOP_X_STOP, 9);
    }
  });

  it('continuity at T_STOP: pos and vel match from both sides', () => {
    const before = sampleSourceState('sudden_stop', T0 - 1e-9);
    const after = sampleSourceState('sudden_stop', T0 + 1e-9);
    expect(before.pos.x).toBeCloseTo(after.pos.x, 5);
    expect(before.vel.x).toBeCloseTo(after.vel.x, 5);
  });

  it('continuity at T_STOP+T_BRAKE: pos matches X_STOP from both sides', () => {
    const tEnd = T0 + TB;
    const before = sampleSourceState('sudden_stop', tEnd - 1e-9);
    const after = sampleSourceState('sudden_stop', tEnd + 1e-9);
    expect(before.pos.x).toBeCloseTo(SUDDEN_STOP_X_STOP, 5);
    expect(after.pos.x).toBeCloseTo(SUDDEN_STOP_X_STOP, 5);
  });
});

describe('sampleSourceState: draggable (charge at rest baseline)', () => {
  it('returns zeroed pos/vel/accel for any t (at-rest Coulomb baseline; live tick bypasses this)', () => {
    for (const t of [-5, 0, 1, 10]) {
      const s = sampleSourceState('draggable', t);
      expect(s.t).toBe(t);
      expect(s.pos.x).toBe(0); expect(s.pos.y).toBe(0);
      expect(s.vel.x).toBe(0); expect(s.vel.y).toBe(0);
      expect(s.accel.x).toBe(0); expect(s.accel.y).toBe(0);
    }
  });
});

// ─── maxHistorySpeed ──────────────────────────────────────────────────────────

describe('maxHistorySpeed', () => {
  it('uniform_velocity → SUDDEN_STOP_V', () => {
    expect(maxHistorySpeed('uniform_velocity')).toBe(SUDDEN_STOP_V);
  });

  it('sudden_stop → SUDDEN_STOP_V (retains moving history after stop)', () => {
    expect(maxHistorySpeed('sudden_stop')).toBe(SUDDEN_STOP_V);
  });

  it('draggable → 0 (dynamic speed tracked separately via dragPeakSpeedRef)', () => {
    expect(maxHistorySpeed('draggable')).toBe(0);
  });
});

// ─── brakingSubstepTimes ──────────────────────────────────────────────────────

describe('brakingSubstepTimes', () => {
  const T0 = SUDDEN_STOP_T_STOP;
  const TB = SUDDEN_STOP_T_BRAKE;
  const brakeEnd = T0 + TB;

  it('returns [] when both times before braking window', () => {
    expect(brakingSubstepTimes(0, T0 - 0.1)).toEqual([]);
  });

  it('returns [] when both times after braking window', () => {
    expect(brakingSubstepTimes(brakeEnd + 0.1, brakeEnd + 0.5)).toEqual([]);
  });

  it('always includes T_STOP when prevSimTime < T_STOP < currentSimTime', () => {
    const result = brakingSubstepTimes(T0 - 0.05, T0 + 0.05);
    expect(result).toContain(T0);
  });

  it('always includes T_STOP+T_BRAKE when prevSimTime < T_STOP+T_BRAKE < currentSimTime', () => {
    const result = brakingSubstepTimes(T0 + 0.1, brakeEnd + 0.05);
    expect(result).toContain(brakeEnd);
  });

  it('includes both boundaries when a single frame spans the entire braking window', () => {
    const result = brakingSubstepTimes(T0 - 0.1, brakeEnd + 0.1);
    expect(result).toContain(T0);
    expect(result).toContain(brakeEnd);
  });

  it('interior substep spacing ≤ SUDDEN_STOP_BRAKE_SUBSTEP_DT', () => {
    // Frame that spans interior of braking window
    const result = brakingSubstepTimes(T0 - 0.1, brakeEnd + 0.1);
    // Filter to interior substeps only (not boundary anchors)
    const interior = result.filter(t => t !== T0 && t !== brakeEnd);
    // Build sorted list including boundaries to check all gaps
    const allPoints = [T0, ...interior, brakeEnd].sort((a, b) => a - b);
    for (let i = 1; i < allPoints.length; i++) {
      expect(allPoints[i] - allPoints[i - 1]).toBeLessThanOrEqual(SUDDEN_STOP_BRAKE_SUBSTEP_DT + 1e-9);
    }
  });

  it('all returned times are strictly inside (prevSimTime, currentSimTime)', () => {
    const prev = T0 - 0.05;
    const curr = brakeEnd + 0.05;
    const result = brakingSubstepTimes(prev, curr);
    for (const t of result) {
      expect(t).toBeGreaterThan(prev);
      expect(t).toBeLessThan(curr);
    }
  });

  it('returned times are strictly increasing', () => {
    const result = brakingSubstepTimes(T0 - 0.1, brakeEnd + 0.1);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });
});

// ─── Physics integration test ─────────────────────────────────────────────────

describe('sudden_stop physics integration', () => {
  const T0 = SUDDEN_STOP_T_STOP;
  const TB = SUDDEN_STOP_T_BRAKE;
  const config = { c: 1.0, softening: 0.01 };

  // Build dense sudden_stop history from t = −10 to T_STOP + T_BRAKE + 1.5
  function buildSuddenStopHistory(): ChargeHistory {
    const history = new ChargeHistory();
    const tEnd = T0 + TB + 1.5;
    const dt = 0.005;
    for (let t = -10; t <= tEnd + 1e-9; t += dt) {
      history.recordState(sampleSourceState('sudden_stop', t));
    }
    return history;
  }

  // Observation time: 1 s after braking ends
  const tObs = T0 + TB + 1.0;

  // Three observation points (perpendicular to motion, at x = X_STOP)
  // Shell inner radius ≈ 1.0 (retarded distance for stationary: 1.0 s * c)
  // Shell outer radius ≈ 1.2 (retarded distance from start of braking: 1.2 s * c)
  const insidePos = { x: SUDDEN_STOP_X_STOP, y: 0.5 };  // inside shell → Coulomb
  const shellPos = { x: SUDDEN_STOP_X_STOP, y: 1.1 };   // on shell → high eAccel
  const outsidePos = { x: SUDDEN_STOP_X_STOP, y: 1.5 }; // outside shell → moving field

  it('eAccel magnitude is substantially larger on shell than inside or outside', () => {
    const history = buildSuddenStopHistory();

    const inside = evaluateLienardWiechertField({
      observationPos: insidePos, observationTime: tObs, history, charge: 1, config,
    });
    const shell = evaluateLienardWiechertField({
      observationPos: shellPos, observationTime: tObs, history, charge: 1, config,
    });
    const outside = evaluateLienardWiechertField({
      observationPos: outsidePos, observationTime: tObs, history, charge: 1, config,
    });

    expect(shell).not.toBeNull();
    expect(inside).not.toBeNull();
    expect(outside).not.toBeNull();

    const magShell = Math.sqrt(shell!.eAccel.x ** 2 + shell!.eAccel.y ** 2);
    const magInside = Math.sqrt(inside!.eAccel.x ** 2 + inside!.eAccel.y ** 2);
    const magOutside = Math.sqrt(outside!.eAccel.x ** 2 + outside!.eAccel.y ** 2);

    expect(magShell).toBeGreaterThan(5 * magInside);
    expect(magShell).toBeGreaterThan(5 * magOutside);
  });

  it('inside-shell eVel matches at-rest Coulomb field at X_STOP', () => {
    const history = buildSuddenStopHistory();

    // Reference: charge at rest at X_STOP (pure Coulomb baseline)
    const refHistory = new ChargeHistory();
    for (let t = -10; t <= tObs + 1e-9; t += 0.005) {
      refHistory.recordState({ t, pos: { x: SUDDEN_STOP_X_STOP, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } });
    }

    const actual = evaluateLienardWiechertField({
      observationPos: insidePos, observationTime: tObs, history, charge: 1, config,
    });
    const ref = evaluateLienardWiechertField({
      observationPos: insidePos, observationTime: tObs, history: refHistory, charge: 1, config,
    });

    expect(actual).not.toBeNull();
    expect(ref).not.toBeNull();
    expect(Math.abs(actual!.eVel.x - ref!.eVel.x)).toBeLessThan(0.05);
    expect(Math.abs(actual!.eVel.y - ref!.eVel.y)).toBeLessThan(0.05);
  });

  it('outside-shell eVel matches uniform_velocity field (component-wise)', () => {
    const history = buildSuddenStopHistory();

    // Reference: charge moving at uniform_velocity for all time
    const refHistory = new ChargeHistory();
    for (let t = -10; t <= tObs + 1e-9; t += 0.005) {
      refHistory.recordState(sampleSourceState('uniform_velocity', t));
    }

    const actual = evaluateLienardWiechertField({
      observationPos: outsidePos, observationTime: tObs, history, charge: 1, config,
    });
    const ref = evaluateLienardWiechertField({
      observationPos: outsidePos, observationTime: tObs, history: refHistory, charge: 1, config,
    });

    expect(actual).not.toBeNull();
    expect(ref).not.toBeNull();
    // Component-wise: verifies that outside observers "see" the charge at its
    // would-have-been position (beamed field direction), not just similar magnitude.
    expect(Math.abs(actual!.eVel.x - ref!.eVel.x)).toBeLessThan(0.05);
    expect(Math.abs(actual!.eVel.y - ref!.eVel.y)).toBeLessThan(0.05);
  });
});

// ─── sampleSuddenStopState (parameterized brakeStartTime) ────────────────────

describe('sampleSuddenStopState: custom brakeStartTime', () => {
  const CUSTOM_T = 5.0; // different from SUDDEN_STOP_T_STOP = 2.0
  const TB = SUDDEN_STOP_T_BRAKE;
  const brakeEnd = CUSTOM_T + TB;
  const xStop = SUDDEN_STOP_V * CUSTOM_T + SUDDEN_STOP_V * TB / 2;

  it('moving phase (t < CUSTOM_T) matches uniform_velocity', () => {
    for (const t of [-3, 0, 1, CUSTOM_T - 0.001]) {
      const s = sampleSuddenStopState(t, CUSTOM_T);
      expect(s.pos.x).toBeCloseTo(SUDDEN_STOP_V * t, 9);
      expect(s.vel.x).toBeCloseTo(SUDDEN_STOP_V, 9);
      expect(s.accel.x).toBe(0);
    }
  });

  it('braking phase: accel.x = −V/T_BRAKE', () => {
    const expectedAccel = -SUDDEN_STOP_V / TB;
    for (const t of [CUSTOM_T, CUSTOM_T + 0.05, CUSTOM_T + TB - 0.001]) {
      const s = sampleSuddenStopState(t, CUSTOM_T);
      expect(s.accel.x).toBeCloseTo(expectedAccel, 9);
    }
  });

  it('stopped phase: vel=0, pos=xStop', () => {
    for (const t of [brakeEnd, brakeEnd + 0.5, brakeEnd + 2]) {
      const s = sampleSuddenStopState(t, CUSTOM_T);
      expect(s.vel.x).toBeCloseTo(0, 9);
      expect(s.pos.x).toBeCloseTo(xStop, 9);
    }
  });

  it('sampleSourceState delegates to sampleSuddenStopState(t, T_STOP)', () => {
    // They must be identical for all t — including the braking window.
    for (const t of [-1, 0, SUDDEN_STOP_T_STOP, SUDDEN_STOP_T_STOP + 0.1, SUDDEN_STOP_T_STOP + SUDDEN_STOP_T_BRAKE + 1]) {
      const via_sss = sampleSuddenStopState(t, SUDDEN_STOP_T_STOP);
      const via_sampleSourceState = sampleSourceState('sudden_stop', t);
      expect(via_sss.pos.x).toBeCloseTo(via_sampleSourceState.pos.x, 12);
      expect(via_sss.vel.x).toBeCloseTo(via_sampleSourceState.vel.x, 12);
      expect(via_sss.accel.x).toBeCloseTo(via_sampleSourceState.accel.x, 12);
    }
  });

  it('xStop is consistent with SUDDEN_STOP_X_STOP when brakeStartTime = T_STOP', () => {
    const s = sampleSuddenStopState(SUDDEN_STOP_T_STOP + SUDDEN_STOP_T_BRAKE + 1, SUDDEN_STOP_T_STOP);
    expect(s.pos.x).toBeCloseTo(SUDDEN_STOP_X_STOP, 9);
  });
});

// ─── sampleSourceState: oscillating ──────────────────────────────────────────

describe('sampleSourceState: oscillating', () => {
  const A = OSCILLATING_AMPLITUDE;
  const W = OSCILLATING_OMEGA;

  it('pos.x = A·sin(ω·t), vel.x = A·ω·cos(ω·t), accel.x = −A·ω²·sin(ω·t)', () => {
    for (const t of [-Math.PI, -1, 0, 0.5, Math.PI / 2, Math.PI]) {
      const s = sampleSourceState('oscillating', t);
      expect(s.pos.x).toBeCloseTo(A * Math.sin(W * t), 10);
      expect(s.vel.x).toBeCloseTo(A * W * Math.cos(W * t), 10);
      expect(s.accel.x).toBeCloseTo(-A * W ** 2 * Math.sin(W * t), 10);
    }
  });

  it('pos.y, vel.y, accel.y are all zero', () => {
    for (const t of [-1, 0, 1]) {
      const s = sampleSourceState('oscillating', t);
      expect(s.pos.y).toBe(0);
      expect(s.vel.y).toBe(0);
      expect(s.accel.y).toBe(0);
    }
  });

  it('at t=0: pos=0, vel=A·ω (max), accel=0', () => {
    const s = sampleSourceState('oscillating', 0);
    expect(s.pos.x).toBeCloseTo(0, 12);
    expect(s.vel.x).toBeCloseTo(A * W, 12);
    expect(s.accel.x).toBeCloseTo(0, 12);
  });

  it('at t=π/(2ω): pos=A (max), vel=0, accel=−A·ω² (max negative)', () => {
    const t = Math.PI / (2 * W);
    const s = sampleSourceState('oscillating', t);
    expect(s.pos.x).toBeCloseTo(A, 10);
    expect(s.vel.x).toBeCloseTo(0, 10);
    expect(s.accel.x).toBeCloseTo(-A * W ** 2, 10);
  });
});

// ─── maxHistorySpeed: oscillating ────────────────────────────────────────────

describe('maxHistorySpeed: oscillating', () => {
  it('returns A·ω = 0.5', () => {
    expect(maxHistorySpeed('oscillating')).toBeCloseTo(OSCILLATING_AMPLITUDE * OSCILLATING_OMEGA, 12);
  });
});

// ─── brakingSubstepTimes: custom brakeStartTime ───────────────────────────────

describe('brakingSubstepTimes: custom brakeStartTime', () => {
  const CUSTOM_T = 7.0;
  const TB = SUDDEN_STOP_T_BRAKE;
  const brakeEnd = CUSTOM_T + TB;

  it('returns [] when both times before the custom braking window', () => {
    expect(brakingSubstepTimes(0, CUSTOM_T - 0.1, CUSTOM_T)).toEqual([]);
  });

  it('returns [] when both times after the custom braking window', () => {
    expect(brakingSubstepTimes(brakeEnd + 0.1, brakeEnd + 0.5, CUSTOM_T)).toEqual([]);
  });

  it('includes CUSTOM_T when frame spans its entry', () => {
    const result = brakingSubstepTimes(CUSTOM_T - 0.05, CUSTOM_T + 0.05, CUSTOM_T);
    expect(result).toContain(CUSTOM_T);
  });

  it('includes brakeEnd when frame spans its entry', () => {
    const result = brakingSubstepTimes(CUSTOM_T + 0.1, brakeEnd + 0.05, CUSTOM_T);
    expect(result).toContain(brakeEnd);
  });

  it('default brakeStartTime = SUDDEN_STOP_T_STOP matches explicit call', () => {
    const prev = SUDDEN_STOP_T_STOP - 0.1;
    const curr = SUDDEN_STOP_T_STOP + SUDDEN_STOP_T_BRAKE + 0.1;
    const defaultResult  = brakingSubstepTimes(prev, curr);
    const explicitResult = brakingSubstepTimes(prev, curr, SUDDEN_STOP_T_STOP);
    expect(defaultResult).toEqual(explicitResult);
  });
});

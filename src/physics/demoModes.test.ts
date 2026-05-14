import { describe, it, expect } from 'vitest';
import {
  sampleSourceState,
  sampleSuddenStopState,
  sampleDemoChargeStates,
  sampleStoppedDemoChargeStates,
  sampleStoppedHarmonicState,
  sampleStoppedHydrogenState,
  isStoppableMode,
  maxHistorySpeed,
  brakingSubstepTimes,
  SUDDEN_STOP_V,
  SUDDEN_STOP_T_STOP,
  SUDDEN_STOP_T_BRAKE,
  SUDDEN_STOP_BRAKE_SUBSTEP_DT,
  SUDDEN_STOP_X_STOP,
  OSCILLATING_AMPLITUDE,
  OSCILLATING_OMEGA,
  DIPOLE_SEPARATION,
  HYDROGEN_ORBIT_RADIUS,
  HYDROGEN_OMEGA,
  WATER_O_CHARGE,
  WATER_H_CHARGE,
  WATER_BOND_LENGTH,
  WATER_HOH_ANGLE_RAD,
  WATER_STRETCH_AMPLITUDE,
  WATER_STRETCH_OMEGA,
  WATER_BEND_AMPLITUDE,
  WATER_BEND_AMPLITUDE_RAD,
  WATER_BEND_OMEGA,
  WATER_ASYM_STRETCH_OMEGA,
  WATER_M_O,
  WATER_M_H,
  WATER_O_EQ_Y,
  WATER_H_EQ_X,
  WATER_H_EQ_Y,
} from './demoModes';
import { minCForMode } from '@/rendering/wavefrontWebGLConfig';
import { ChargeHistory } from './chargeHistory';
import { evaluateLienardWiechertField } from './lienardWiechert';

// ─── sampleSourceState ────────────────────────────────────────────────────────

describe('sampleSourceState: moving_charge (pre-stop baseline)', () => {
  it('pos=(0.6t,0), vel=(0.6,0), accel=(0,0) for t = −2, 0, 1', () => {
    for (const t of [-2, 0, 1]) {
      const s = sampleSourceState('moving_charge', t);
      expect(s.pos.x).toBeCloseTo(SUDDEN_STOP_V * t);
      expect(s.pos.y).toBe(0);
      expect(s.vel.x).toBeCloseTo(SUDDEN_STOP_V);
      expect(s.vel.y).toBe(0);
      expect(s.accel.x).toBe(0);
      expect(s.accel.y).toBe(0);
    }
  });
});

describe('sampleSuddenStopState: default brakeStartTime (T_STOP)', () => {
  const T0 = SUDDEN_STOP_T_STOP;
  const TB = SUDDEN_STOP_T_BRAKE;

  it('moving phase (t < T_STOP) matches moving_charge baseline', () => {
    for (const t of [-5, 0, 1, T0 - 0.001]) {
      const ss = sampleSuddenStopState(t, T0);
      const mv = sampleSourceState('moving_charge', t);
      expect(ss.pos.x).toBeCloseTo(mv.pos.x, 9);
      expect(ss.vel.x).toBeCloseTo(mv.vel.x, 9);
      expect(ss.accel.x).toBe(0);
    }
  });

  it('braking phase: accel.x = −V/T_BRAKE throughout', () => {
    const expectedAccel = -SUDDEN_STOP_V / TB;
    for (const t of [T0, T0 + 0.05, T0 + 0.1, T0 + TB - 0.001]) {
      const s = sampleSuddenStopState(t, T0);
      expect(s.accel.x).toBeCloseTo(expectedAccel, 9);
      expect(s.accel.y).toBe(0);
    }
  });

  it('braking phase: vel.x = V at T_STOP, 0 at T_STOP+T_BRAKE', () => {
    expect(sampleSuddenStopState(T0, T0).vel.x).toBeCloseTo(SUDDEN_STOP_V, 9);
    expect(sampleSuddenStopState(T0 + TB, T0).vel.x).toBeCloseTo(0, 9);
  });

  it('braking phase: vel.x strictly decreasing', () => {
    const times = [T0, T0 + 0.05, T0 + 0.1, T0 + 0.15, T0 + TB];
    for (let i = 1; i < times.length; i++) {
      const prev = sampleSuddenStopState(times[i - 1], T0);
      const curr = sampleSuddenStopState(times[i], T0);
      expect(curr.vel.x).toBeLessThan(prev.vel.x);
    }
  });

  it('stopped phase: vel=(0,0), accel=(0,0), pos.x = X_STOP', () => {
    for (const t of [T0 + TB, T0 + TB + 0.5, T0 + TB + 2]) {
      const s = sampleSuddenStopState(t, T0);
      expect(s.vel.x).toBeCloseTo(0, 9);
      expect(s.vel.y).toBe(0);
      expect(s.accel.x).toBeCloseTo(0, 9);
      expect(s.accel.y).toBe(0);
      expect(s.pos.x).toBeCloseTo(SUDDEN_STOP_X_STOP, 9);
    }
  });

  it('continuity at T_STOP: pos and vel match from both sides', () => {
    const before = sampleSuddenStopState(T0 - 1e-9, T0);
    const after  = sampleSuddenStopState(T0 + 1e-9, T0);
    expect(before.pos.x).toBeCloseTo(after.pos.x, 5);
    expect(before.vel.x).toBeCloseTo(after.vel.x, 5);
  });

  it('continuity at T_STOP+T_BRAKE: pos matches X_STOP from both sides', () => {
    const tEnd = T0 + TB;
    const before = sampleSuddenStopState(tEnd - 1e-9, T0);
    const after  = sampleSuddenStopState(tEnd + 1e-9, T0);
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
  it('moving_charge → SUDDEN_STOP_V (retains pre-stop moving history after stop)', () => {
    expect(maxHistorySpeed('moving_charge')).toBe(SUDDEN_STOP_V);
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
      history.recordState(sampleSuddenStopState(t, T0));
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

    // Reference: charge moving at constant velocity for all time (moving_charge baseline)
    const refHistory = new ChargeHistory();
    for (let t = -10; t <= tObs + 1e-9; t += 0.005) {
      refHistory.recordState(sampleSourceState('moving_charge', t));
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

// ─── water modes (M14) ───────────────────────────────────────────────────────
//
// Geometry safety preconditions and policy assertions live at module scope so
// they fail loudly the moment a future tuning pushes any constant past its
// safe window — independently of the per-mode behavioral tests below.

describe('water modes: geometry safety preconditions', () => {
  it('water_bend: theta(t) stays in (0, pi) so sin(theta/2) > 0 and the H_+x / H_-x labels are stable across all t', () => {
    expect(WATER_HOH_ANGLE_RAD - WATER_BEND_AMPLITUDE_RAD).toBeGreaterThan(0);
    expect(WATER_HOH_ANGLE_RAD + WATER_BEND_AMPLITUDE_RAD).toBeLessThan(Math.PI);
  });

  it('water_stretch: L(t) stays positive so the H atom never crosses O', () => {
    expect(WATER_BOND_LENGTH - WATER_STRETCH_AMPLITUDE).toBeGreaterThan(0);
  });
});

describe('water modes: policy assertions', () => {
  it('both modes share CMIN_OSCILLATING because peak H speed <= 0.5', () => {
    // Direct policy contract: water rides oscillating's c-min bucket.
    expect(maxHistorySpeed('water_stretch')).toBeLessThanOrEqual(0.5);
    expect(maxHistorySpeed('water_bend')).toBeLessThanOrEqual(0.5);
    // Downstream consequence: minCForMode resolves to CMIN_OSCILLATING (= 0.62).
    expect(minCForMode('water_stretch')).toBeCloseTo(0.62, 6);
    expect(minCForMode('water_bend')).toBeCloseTo(0.62, 6);
  });

  it('maxHistorySpeed: stretch = A_stretch·ω_stretch, bend = A_bend·ω_bend (H δ binds the budget)', () => {
    expect(maxHistorySpeed('water_stretch')).toBeCloseTo(WATER_STRETCH_AMPLITUDE * WATER_STRETCH_OMEGA, 12);
    expect(maxHistorySpeed('water_bend')).toBeCloseTo(WATER_BEND_AMPLITUDE * WATER_BEND_OMEGA, 12);
  });
});

// ─── water modes: COM conservation (M15-A) ───────────────────────────────────
//
// All three atoms move; the mass-weighted COM stays at the world origin at
// all t by construction. Empirically verified across position, velocity, and
// acceleration to catch sign errors and coefficient drift independently.

describe('water modes: mass-weighted COM is conserved at world origin (position, velocity, acceleration)', () => {
  const WATER_MODES_FOR_COM = [
    { name: 'water_stretch'      as const, omega: WATER_STRETCH_OMEGA      },
    { name: 'water_bend'         as const, omega: WATER_BEND_OMEGA         },
    { name: 'water_asym_stretch' as const, omega: WATER_ASYM_STRETCH_OMEGA },
  ];

  for (const { name, omega } of WATER_MODES_FOR_COM) {
    it(`${name}: m_O·r_O + m_H·(r_H+ + r_H-) ≈ 0 across the full period`, () => {
      const T = (2 * Math.PI) / omega;
      const SAMPLES = 41; // dense sweep, avoids aliasing to extrema only
      for (let i = 0; i < SAMPLES; i++) {
        const t = (i / (SAMPLES - 1)) * T;
        const specs = sampleDemoChargeStates(name, t);
        const o  = specs[0].state;
        const hp = specs[1].state;
        const hm = specs[2].state;

        const comX = WATER_M_O * o.pos.x + WATER_M_H * (hp.pos.x + hm.pos.x);
        const comY = WATER_M_O * o.pos.y + WATER_M_H * (hp.pos.y + hm.pos.y);
        expect(comX).toBeCloseTo(0, 10);
        expect(comY).toBeCloseTo(0, 10);

        const comVx = WATER_M_O * o.vel.x + WATER_M_H * (hp.vel.x + hm.vel.x);
        const comVy = WATER_M_O * o.vel.y + WATER_M_H * (hp.vel.y + hm.vel.y);
        expect(comVx).toBeCloseTo(0, 10);
        expect(comVy).toBeCloseTo(0, 10);

        const comAx = WATER_M_O * o.accel.x + WATER_M_H * (hp.accel.x + hm.accel.x);
        const comAy = WATER_M_O * o.accel.y + WATER_M_H * (hp.accel.y + hm.accel.y);
        expect(comAx).toBeCloseTo(0, 10);
        expect(comAy).toBeCloseTo(0, 10);
      }
    });
  }
});

describe('water modes: equilibrium positions (COM-centered, below-O orientation)', () => {
  it('O equilibrium sits slightly above world origin: y_O = +L₀·cos(θ/2)/9', () => {
    const expected = +WATER_BOND_LENGTH * Math.cos(WATER_HOH_ANGLE_RAD / 2) / 9;
    expect(WATER_O_EQ_Y).toBeCloseTo(expected, 12);
    expect(WATER_O_EQ_Y).toBeGreaterThan(0);
  });

  it('H equilibrium sits below origin: y_H = -(8/9)·L₀·cos(θ/2), x_H = ±L₀·sin(θ/2)', () => {
    const expectedY = -(8 / 9) * WATER_BOND_LENGTH * Math.cos(WATER_HOH_ANGLE_RAD / 2);
    const expectedX = WATER_BOND_LENGTH * Math.sin(WATER_HOH_ANGLE_RAD / 2);
    expect(WATER_H_EQ_Y).toBeCloseTo(expectedY, 12);
    expect(WATER_H_EQ_X).toBeCloseTo(expectedX, 12);
    expect(WATER_H_EQ_Y).toBeLessThan(0);
    expect(WATER_H_EQ_X).toBeGreaterThan(0);
  });

  it('at t = 0 the molecule sits at its equilibrium positions for all three modes', () => {
    for (const name of ['water_stretch', 'water_bend', 'water_asym_stretch'] as const) {
      const specs = sampleDemoChargeStates(name, 0);
      expect(specs[0].state.pos.x).toBeCloseTo(0,             12);
      expect(specs[0].state.pos.y).toBeCloseTo(WATER_O_EQ_Y,  12);
      expect(specs[1].state.pos.x).toBeCloseTo(+WATER_H_EQ_X, 12);
      expect(specs[1].state.pos.y).toBeCloseTo(WATER_H_EQ_Y,  12);
      expect(specs[2].state.pos.x).toBeCloseTo(-WATER_H_EQ_X, 12);
      expect(specs[2].state.pos.y).toBeCloseTo(WATER_H_EQ_Y,  12);
    }
  });
});

describe('water_bend: O–H bond length is preserved to first order in displacement amplitude', () => {
  // The bend normal mode is defined by the property that, to first order in
  // the displacement amplitude, only the H-O-H angle changes and the O-H
  // bond lengths are conserved. This is equivalent to the relative O-H
  // displacement being tangent to the equilibrium bond direction:
  //   u · (δ_H± - δ_O) = 0
  // where u is the equilibrium bond unit vector. Equivalently, the
  // relative O-H velocity at peak velocity (t = 0, cos(ω·t) = 1) is
  // perpendicular to u. This test asserts the velocity form so a future
  // basis edit that breaks first-order bond-length conservation regresses
  // here loudly.
  it('relative O–H velocity at peak velocity is perpendicular to the equilibrium bond direction (both H atoms)', () => {
    const specs = sampleDemoChargeStates('water_bend', 0);
    const o  = specs[0].state;
    const hp = specs[1].state;
    const hm = specs[2].state;

    // Equilibrium bond unit vectors from O_eq to H±_eq.
    const bondLen = Math.hypot(WATER_H_EQ_X - 0, WATER_H_EQ_Y - WATER_O_EQ_Y);
    expect(bondLen).toBeCloseTo(WATER_BOND_LENGTH, 12);
    const uPlusX  = (WATER_H_EQ_X      - 0) / bondLen;
    const uPlusY  = (WATER_H_EQ_Y - WATER_O_EQ_Y) / bondLen;
    const uMinusX = (-WATER_H_EQ_X     - 0) / bondLen;
    const uMinusY = (WATER_H_EQ_Y - WATER_O_EQ_Y) / bondLen;

    // Relative O–H velocity at peak |cos(ω·t)| = 1 (here t=0).
    const vRelPlusX  = hp.vel.x - o.vel.x;
    const vRelPlusY  = hp.vel.y - o.vel.y;
    const vRelMinusX = hm.vel.x - o.vel.x;
    const vRelMinusY = hm.vel.y - o.vel.y;

    // u · v_rel must be ≈ 0 for first-order bond-length preservation.
    expect(uPlusX  * vRelPlusX  + uPlusY  * vRelPlusY ).toBeCloseTo(0, 12);
    expect(uMinusX * vRelMinusX + uMinusY * vRelMinusY).toBeCloseTo(0, 12);
  });

  // Direct numerical confirmation: at small finite A·sin(ω·t), the bond
  // length should differ from L₀ by O(A²/L₀), not O(A). Sample bond
  // length deviation at a small phase fraction and verify it shrinks
  // quadratically when the phase is halved.
  it('bond length deviation from L₀ scales as O(phase²) — not O(phase) — for small phases', () => {
    const T = (2 * Math.PI) / WATER_BEND_OMEGA;
    const samplePhase = (frac: number) => {
      const t = frac * T;
      const specs = sampleDemoChargeStates('water_bend', t);
      const o  = specs[0].state.pos;
      const hp = specs[1].state.pos;
      const bondLen = Math.hypot(hp.x - o.x, hp.y - o.y);
      return Math.abs(bondLen - WATER_BOND_LENGTH);
    };
    const dev1 = samplePhase(0.005);   // small phase
    const dev2 = samplePhase(0.0025);  // half the phase
    // Linear behavior would give dev1/dev2 ≈ 2; quadratic gives ≈ 4.
    // Allow some margin: the ratio must be clearly > 3.
    expect(dev1 / dev2).toBeGreaterThan(3);
  });
});

describe('water modes: empirical peak speed ≤ maxHistorySpeed(mode) ≤ 0.5', () => {
  // Velocity for each mode is A·ω·cos(ω·t)·δ_atom, so |v| peaks where
  // |cos(ω·t)| = 1, i.e. at t = 0, T/2, T, ... — the cosine extrema. The
  // interior dense grid is a regression check. (M15-A originally used
  // quarter-period offsets, which sample at the sin extrema — displacement
  // peaks, velocity zeros; back-fixed in M15-B.)
  const WATER_MODES_FOR_SPEED = [
    { name: 'water_stretch'      as const, omega: WATER_STRETCH_OMEGA      },
    { name: 'water_bend'         as const, omega: WATER_BEND_OMEGA         },
    { name: 'water_asym_stretch' as const, omega: WATER_ASYM_STRETCH_OMEGA },
  ];

  for (const { name, omega } of WATER_MODES_FOR_SPEED) {
    it(`${name}: observed peak speed ≤ maxHistorySpeed(mode), and ≤ 0.5`, () => {
      const T = (2 * Math.PI) / omega;
      const velocityExtrema = [0, T / 2, T];
      const denseGrid: number[] = [];
      const DENSE = 51;
      for (let i = 0; i < DENSE; i++) denseGrid.push((i / (DENSE - 1)) * T);

      let peak = 0;
      for (const t of [...velocityExtrema, ...denseGrid]) {
        const specs = sampleDemoChargeStates(name, t);
        for (const s of specs) {
          const sp = Math.hypot(s.state.vel.x, s.state.vel.y);
          if (sp > peak) peak = sp;
        }
      }
      const budget = maxHistorySpeed(name);
      expect(peak).toBeLessThanOrEqual(budget + 1e-9);
      expect(peak).toBeLessThanOrEqual(0.5 + 1e-9);
    });
  }
});

// Per-mode behavioral tests. Split into two sweeps: universal tests that
// apply to all three water modes, and mirror-symmetric tests that only
// apply to symmetric stretch and bend (asym stretch breaks mirror symmetry
// across the C₂ axis and moves O along x̂, not ŷ).
const WATER_MODES_UNIVERSAL = [
  { name: 'water_stretch'      as const, omega: WATER_STRETCH_OMEGA      },
  { name: 'water_bend'         as const, omega: WATER_BEND_OMEGA         },
  { name: 'water_asym_stretch' as const, omega: WATER_ASYM_STRETCH_OMEGA },
] as const;

const WATER_MODES_MIRROR_SYMMETRIC = [
  { name: 'water_stretch' as const, omega: WATER_STRETCH_OMEGA },
  { name: 'water_bend'    as const, omega: WATER_BEND_OMEGA    },
] as const;

for (const { name, omega } of WATER_MODES_UNIVERSAL) {
  describe(`${name}: universal behavioral tests`, () => {
    const T = (2 * Math.PI) / omega;          // one period in sandbox seconds
    const SAMPLES = 25;                        // t-sweep density
    const tSweep: number[] = [];
    for (let i = 0; i < SAMPLES; i++) tSweep.push((i / (SAMPLES - 1)) * T);

    it('returns 3 charge specs', () => {
      for (const t of tSweep) {
        expect(sampleDemoChargeStates(name, t).length).toBe(3);
      }
    });

    it('net charge is zero', () => {
      const specs = sampleDemoChargeStates(name, 0);
      const sum = specs.reduce((acc, s) => acc + s.charge, 0);
      expect(sum).toBeCloseTo(0, 12);
    });

    it('c-min margin sweep: peak speed across all three charges over one period stays below minCForMode - 0.1', () => {
      const cMinMargin = minCForMode(name) - 0.1;
      let peakSpeed = 0;
      for (const t of tSweep) {
        const specs = sampleDemoChargeStates(name, t);
        for (const s of specs) {
          const sp = Math.hypot(s.state.vel.x, s.state.vel.y);
          if (sp > peakSpeed) peakSpeed = sp;
        }
      }
      expect(peakSpeed).toBeLessThan(cMinMargin);
    });

    it('periodicity: state(t + T) ≈ state(t) for all 3 charges at several t', () => {
      const probeTimes = [0, T * 0.137, T * 0.413, T * 0.781];
      for (const t of probeTimes) {
        const a = sampleDemoChargeStates(name, t);
        const b = sampleDemoChargeStates(name, t + T);
        for (let ci = 0; ci < 3; ci++) {
          expect(a[ci].charge).toBe(b[ci].charge);
          expect(a[ci].state.pos.x).toBeCloseTo(b[ci].state.pos.x, 10);
          expect(a[ci].state.pos.y).toBeCloseTo(b[ci].state.pos.y, 10);
          expect(a[ci].state.vel.x).toBeCloseTo(b[ci].state.vel.x, 10);
          expect(a[ci].state.vel.y).toBeCloseTo(b[ci].state.vel.y, 10);
          expect(a[ci].state.accel.x).toBeCloseTo(b[ci].state.accel.x, 10);
          expect(a[ci].state.accel.y).toBeCloseTo(b[ci].state.accel.y, 10);
        }
      }
    });

    it('stable label ordering preserved across t: index 0 = O (charge < 0), index 1 = H_+x (charge > 0, pos.x > 0), index 2 = H_-x (charge > 0, pos.x < 0)', () => {
      for (const t of tSweep) {
        const specs = sampleDemoChargeStates(name, t);
        expect(specs[0].charge).toBeLessThan(0);
        expect(specs[0].charge).toBe(WATER_O_CHARGE);
        expect(specs[1].charge).toBeGreaterThan(0);
        expect(specs[1].charge).toBe(WATER_H_CHARGE);
        expect(specs[1].state.pos.x).toBeGreaterThan(0);
        expect(specs[2].charge).toBeGreaterThan(0);
        expect(specs[2].charge).toBe(WATER_H_CHARGE);
        expect(specs[2].state.pos.x).toBeLessThan(0);
      }
    });
  });
}

for (const { name, omega } of WATER_MODES_MIRROR_SYMMETRIC) {
  describe(`${name}: mirror-symmetric behavioral tests (stretch and bend only)`, () => {
    const T = (2 * Math.PI) / omega;
    const SAMPLES = 25;
    const tSweep: number[] = [];
    for (let i = 0; i < SAMPLES; i++) tSweep.push((i / (SAMPLES - 1)) * T);

    it('O at index 0 moves only along the C₂ (y) axis across one period (δ_O is along ŷ)', () => {
      for (const t of tSweep) {
        const specs = sampleDemoChargeStates(name, t);
        expect(specs[0].charge).toBe(WATER_O_CHARGE);
        expect(specs[0].state.pos.x).toBeCloseTo(0, 12);
        expect(specs[0].state.vel.x).toBeCloseTo(0, 12);
        expect(specs[0].state.accel.x).toBeCloseTo(0, 12);
      }
    });

    it('mirror symmetry across the C₂ (y) axis: H_+x and H_-x have equal-magnitude opposite-sign x components and equal y components', () => {
      for (const t of tSweep) {
        const specs = sampleDemoChargeStates(name, t);
        const hPlus  = specs[1].state;
        const hMinus = specs[2].state;
        expect(hPlus.pos.x).toBeCloseTo(-hMinus.pos.x, 12);
        expect(hPlus.pos.y).toBeCloseTo( hMinus.pos.y, 12);
        expect(hPlus.vel.x).toBeCloseTo(-hMinus.vel.x, 12);
        expect(hPlus.vel.y).toBeCloseTo( hMinus.vel.y, 12);
        expect(hPlus.accel.x).toBeCloseTo(-hMinus.accel.x, 12);
        expect(hPlus.accel.y).toBeCloseTo( hMinus.accel.y, 12);
      }
    });
  });
}

// ─── water_asym_stretch: mode-specific tests (M15-B) ─────────────────────────
//
// Asym stretch breaks the mirror symmetry that sym stretch and bend preserve:
// O moves along x̂ (not ŷ), and the H atoms do NOT have antimirror x-components.
// These tests assert the asym-specific invariants.

describe('water_asym_stretch: O moves only along the H-H (x) axis', () => {
  it('δ_O is along -x̂; O position, velocity, accel have y = WATER_O_EQ_Y (static) and vary along x', () => {
    const T = (2 * Math.PI) / WATER_ASYM_STRETCH_OMEGA;
    const SAMPLES = 25;
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / (SAMPLES - 1)) * T;
      const specs = sampleDemoChargeStates('water_asym_stretch', t);
      expect(specs[0].charge).toBe(WATER_O_CHARGE);
      // y stays at equilibrium throughout
      expect(specs[0].state.pos.y).toBeCloseTo(WATER_O_EQ_Y, 12);
      expect(specs[0].state.vel.y).toBeCloseTo(0, 12);
      expect(specs[0].state.accel.y).toBeCloseTo(0, 12);
    }
    // x varies (not constant)
    const tQuarter = T / 4; // sin(ω·t) = 1 → displacement extremum
    const sQuarter = sampleDemoChargeStates('water_asym_stretch', tQuarter);
    expect(Math.abs(sQuarter[0].state.pos.x)).toBeGreaterThan(0);
  });
});

describe('water_asym_stretch: antisymmetric bond-length change', () => {
  const T = (2 * Math.PI) / WATER_ASYM_STRETCH_OMEGA;

  function bondLengths(t: number): { b1: number; b2: number } {
    const specs = sampleDemoChargeStates('water_asym_stretch', t);
    const o  = specs[0].state.pos;
    const hp = specs[1].state.pos;
    const hm = specs[2].state.pos;
    return {
      b1: Math.hypot(hp.x - o.x, hp.y - o.y),
      b2: Math.hypot(hm.x - o.x, hm.y - o.y),
    };
  }

  it('sign: at positive amplitude phase b1 > L₀ and b2 < L₀; mirror at negative phase', () => {
    const { b1: b1Pos, b2: b2Pos } = bondLengths(T / 4);   // sin(ω·t) = +1
    const { b1: b1Neg, b2: b2Neg } = bondLengths(3 * T / 4); // sin(ω·t) = -1
    expect(b1Pos).toBeGreaterThan(WATER_BOND_LENGTH);
    expect(b2Pos).toBeLessThan(WATER_BOND_LENGTH);
    expect(b1Neg).toBeLessThan(WATER_BOND_LENGTH);
    expect(b2Neg).toBeGreaterThan(WATER_BOND_LENGTH);
  });

  it('antisymmetric dominates symmetric: at peak amplitude |sum/(diff)| is small (≤ 0.1)', () => {
    const { b1, b2 } = bondLengths(T / 4);
    const d1 = b1 - WATER_BOND_LENGTH;
    const d2 = b2 - WATER_BOND_LENGTH;
    // First-order contributions cancel in d1 + d2; only O(A²) survives.
    // (d1 - d2) is the antisymmetric, first-order in A.
    const ratio = Math.abs((d1 + d2) / (d1 - d2));
    expect(ratio).toBeLessThan(0.1);
  });

  it('scaling: antisymmetric difference ~ phase (linear), symmetric sum ~ phase² (quadratic)', () => {
    // Use phase fractions large enough to avoid floating-point cancellation
    // in the symmetric O(A²) term but small enough to stay first-order.
    const phaseSmall = 0.02 * T;
    const phaseHalf  = 0.01 * T;
    const { b1: b1S, b2: b2S } = bondLengths(phaseSmall);
    const { b1: b1H, b2: b2H } = bondLengths(phaseHalf);
    const diffSmall = (b1S - WATER_BOND_LENGTH) - (b2S - WATER_BOND_LENGTH);
    const diffHalf  = (b1H - WATER_BOND_LENGTH) - (b2H - WATER_BOND_LENGTH);
    const sumSmall  = (b1S - WATER_BOND_LENGTH) + (b2S - WATER_BOND_LENGTH);
    const sumHalf   = (b1H - WATER_BOND_LENGTH) + (b2H - WATER_BOND_LENGTH);

    // Antisymmetric difference: phase ratio = 2, so diffSmall / diffHalf ≈ 2.
    expect(diffSmall / diffHalf).toBeGreaterThan(1.7);
    expect(diffSmall / diffHalf).toBeLessThan(2.3);

    // Symmetric sum: phase ratio² = 4, so sumSmall / sumHalf ≈ 4. Allow
    // a wide margin (clearly > 2, ideally > 3) to confirm quadratic scaling.
    expect(Math.abs(sumSmall) / Math.abs(sumHalf)).toBeGreaterThan(3);
  });
});

describe('water_asym_stretch: interior H-O-H angle preserved to first order', () => {
  // The bond angle θ(t) = angle between b_1 and b_2 should be conserved to
  // first order in A. At peak velocity (t = 0, cos(ω·t) = 1), the rate of
  // change of θ should be ≈ 0. Equivalently, both bond directions rotate by
  // the same first-order CCW angle so the angle BETWEEN them is unchanged.
  it('dθ/dt ≈ 0 at peak velocity (t = 0)', () => {
    const specs = sampleDemoChargeStates('water_asym_stretch', 0);
    const o  = specs[0].state;
    const hp = specs[1].state;
    const hm = specs[2].state;

    // Bond vectors at t = 0 (equilibrium).
    const b1x = hp.pos.x - o.pos.x;
    const b1y = hp.pos.y - o.pos.y;
    const b2x = hm.pos.x - o.pos.x;
    const b2y = hm.pos.y - o.pos.y;

    // Bond-vector velocities (relative O–H velocities) at peak velocity.
    const db1x = hp.vel.x - o.vel.x;
    const db1y = hp.vel.y - o.vel.y;
    const db2x = hm.vel.x - o.vel.x;
    const db2y = hm.vel.y - o.vel.y;

    // The bond angle θ = angle between b_1 and b_2 has time derivative
    //   dθ/dt = (d/dt arctan2(b_1y, b_1x)) - (d/dt arctan2(b_2y, b_2x))
    // For a vector (x, y) with derivative (ẋ, ẏ):
    //   d/dt arctan2(y, x) = (x·ẏ - y·ẋ) / (x² + y²)
    const dAlpha1 = (b1x * db1y - b1y * db1x) / (b1x * b1x + b1y * b1y);
    const dAlpha2 = (b2x * db2y - b2y * db2x) / (b2x * b2x + b2y * b2y);
    const dTheta = dAlpha1 - dAlpha2;

    // To first order in A, dTheta should be 0. With our scripted basis the
    // small body-frame rotation is common to both bonds, so it cancels in
    // the difference.
    expect(Math.abs(dTheta)).toBeLessThan(1e-12);
  });
});

// ─── Dipole orientation across all three water modes (M15-B) ─────────────────
//
// The time-varying dipole moment p(t) = Σ q_i · r_i(t) distinguishes the
// modes spectroscopically: sym stretch and bend dipole along ŷ (so they
// radiate primarily along ±x̂), asym stretch dipoles along x̂ (radiating
// primarily along ±ŷ). The dipole's time-derivative magnitude must dominate
// in the named axis; the orthogonal axis carries only static contributions
// (the equilibrium dipole, which doesn't radiate).

describe('water modes: time-varying dipole orientation distinguishes modes', () => {
  function timeVaryingDipoleRange(name: 'water_stretch' | 'water_bend' | 'water_asym_stretch'):
    { rangeX: number; rangeY: number } {
    const omega = name === 'water_stretch'      ? WATER_STRETCH_OMEGA
                : name === 'water_bend'         ? WATER_BEND_OMEGA
                :                                 WATER_ASYM_STRETCH_OMEGA;
    const T = (2 * Math.PI) / omega;
    const SAMPLES = 32;
    let pxMin = +Infinity, pxMax = -Infinity, pyMin = +Infinity, pyMax = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / SAMPLES) * T;
      const specs = sampleDemoChargeStates(name, t);
      let px = 0, py = 0;
      for (const s of specs) {
        px += s.charge * s.state.pos.x;
        py += s.charge * s.state.pos.y;
      }
      if (px < pxMin) pxMin = px;
      if (px > pxMax) pxMax = px;
      if (py < pyMin) pyMin = py;
      if (py > pyMax) pyMax = py;
    }
    return { rangeX: pxMax - pxMin, rangeY: pyMax - pyMin };
  }

  it('water_stretch: dipole y-range dominates (rangeY > 5·rangeX)', () => {
    const { rangeX, rangeY } = timeVaryingDipoleRange('water_stretch');
    expect(rangeY).toBeGreaterThan(5 * rangeX);
  });

  it('water_bend: dipole y-range dominates (rangeY > 5·rangeX)', () => {
    const { rangeX, rangeY } = timeVaryingDipoleRange('water_bend');
    expect(rangeY).toBeGreaterThan(5 * rangeX);
  });

  it('water_asym_stretch: dipole x-range dominates (rangeX > 5·rangeY)', () => {
    const { rangeX, rangeY } = timeVaryingDipoleRange('water_asym_stretch');
    expect(rangeX).toBeGreaterThan(5 * rangeY);
  });
});

// ─── Stop-now generalization (M16) ───────────────────────────────────────────
//
// sampleStoppedHarmonicState, sampleStoppedHydrogenState, and the
// sampleStoppedDemoChargeStates dispatch generalize the moving_charge "Stop
// now" trigger across all stoppable modes. Each tested behavior:
//
//  - Phase 1 (t < T_trig) matches the original analytic state per mode.
//  - Phase 2 (T_trig <= t < brakeEnd) follows the per-mode-family brake formula.
//  - Phase 3 (t >= brakeEnd) is exact rest at the expected terminal config.
//  - Pos and vel are continuous across both phase boundaries; accel is
//    allowed to be discontinuous (the LW shells from those discontinuities are
//    the radiation the student sees).
//
// The harmonic-mode tests sweep multiple T_trig values to exercise all phases
// of the cosine velocity factor (max-vel, zero-vel, mixed). Hydrogen tests
// are explicit since the brake formula is different.

describe('isStoppableMode', () => {
  it('returns false for draggable, true for every other mode', () => {
    expect(isStoppableMode('draggable')).toBe(false);
    expect(isStoppableMode('moving_charge')).toBe(true);
    expect(isStoppableMode('oscillating')).toBe(true);
    expect(isStoppableMode('dipole')).toBe(true);
    expect(isStoppableMode('hydrogen')).toBe(true);
    expect(isStoppableMode('water_stretch')).toBe(true);
    expect(isStoppableMode('water_bend')).toBe(true);
    expect(isStoppableMode('water_asym_stretch')).toBe(true);
  });
});

// Closed-form Hermite cubic and its derivatives — repeated in tests so the
// implementation can't quietly drift from the documented formula.
function hermiteF(s0: number, sDot0: number, TB: number, tau: number): number {
  return s0    * (2 * tau * tau * tau - 3 * tau * tau + 1)
       + sDot0 * TB * (tau * tau * tau - 2 * tau * tau + tau);
}
function hermiteFPrime(s0: number, sDot0: number, TB: number, tau: number): number {
  return s0    * (6 * tau * tau - 6 * tau)
       + sDot0 * TB * (3 * tau * tau - 4 * tau + 1);
}
function hermiteFDoublePrime(s0: number, sDot0: number, TB: number, tau: number): number {
  return s0    * (12 * tau - 6)
       + sDot0 * TB * (6 * tau - 4);
}

describe('sampleStoppedHarmonicState: oscillating brake', () => {
  const A = OSCILLATING_AMPLITUDE;
  const W = OSCILLATING_OMEGA;
  const TB = SUDDEN_STOP_T_BRAKE;

  // Sweep T_trig values exercising max-velocity (t=0), zero-velocity (t=π/2ω),
  // and an intermediate phase. Each test runs over all three.
  const TRIG_PHASES = [
    { name: 'max-vel (t=0)',          T_trig: 0 },
    { name: 'zero-vel (t=π/2ω)',      T_trig: Math.PI / (2 * W) },
    { name: 'intermediate (t=π/3ω)',  T_trig: Math.PI / (3 * W) },
  ];

  for (const { name, T_trig } of TRIG_PHASES) {
    describe(`T_trig phase: ${name}`, () => {
      const brakeEnd = T_trig + TB;

      it('pre-trigger phase matches sampleSourceState exactly', () => {
        for (const t of [T_trig - 1, T_trig - 0.1, T_trig - 1e-9]) {
          const stop = sampleStoppedHarmonicState('oscillating', 0, t, T_trig);
          const orig = sampleSourceState('oscillating', t);
          expect(stop.pos.x).toBeCloseTo(orig.pos.x, 12);
          expect(stop.vel.x).toBeCloseTo(orig.vel.x, 12);
          expect(stop.accel.x).toBeCloseTo(orig.accel.x, 12);
        }
      });

      it('continuity at T_trig: pos and vel match across the trigger', () => {
        const before = sampleStoppedHarmonicState('oscillating', 0, T_trig - 1e-9, T_trig);
        const at     = sampleStoppedHarmonicState('oscillating', 0, T_trig,        T_trig);
        expect(at.pos.x).toBeCloseTo(before.pos.x, 6);
        expect(at.vel.x).toBeCloseTo(before.vel.x, 6);
      });

      it('brake-phase formulas at τ=0.5 match Hermite cubic', () => {
        const tau = 0.5;
        const t = T_trig + tau * TB;
        const stop = sampleStoppedHarmonicState('oscillating', 0, t, T_trig);
        const s0 = A * Math.sin(W * T_trig);
        const sDot0 = A * W * Math.cos(W * T_trig);
        const f   = hermiteF(s0, sDot0, TB, tau);
        const fp  = hermiteFPrime(s0, sDot0, TB, tau);
        const fpp = hermiteFDoublePrime(s0, sDot0, TB, tau);
        // δ = (1, 0) and r_eq = (0, 0) for oscillating.
        expect(stop.pos.x).toBeCloseTo(f, 10);
        expect(stop.vel.x).toBeCloseTo(fp / TB, 10);
        expect(stop.accel.x).toBeCloseTo(fpp / (TB * TB), 10);
      });

      it('left limit at brakeEnd: pos = r_eq, vel = 0, accel = f"(1)/T_BRAKE² (generally nonzero)', () => {
        const stop = sampleStoppedHarmonicState('oscillating', 0, brakeEnd - 1e-9, T_trig);
        expect(stop.pos.x).toBeCloseTo(0, 6);
        expect(stop.vel.x).toBeCloseTo(0, 6);
        const s0 = A * Math.sin(W * T_trig);
        const sDot0 = A * W * Math.cos(W * T_trig);
        const fpp1 = hermiteFDoublePrime(s0, sDot0, TB, 1);
        expect(stop.accel.x).toBeCloseTo(fpp1 / (TB * TB), 5);
      });

      it('exact brakeEnd and beyond: full rest at equilibrium', () => {
        for (const t of [brakeEnd, brakeEnd + 1e-9, brakeEnd + 0.5, brakeEnd + 5]) {
          const stop = sampleStoppedHarmonicState('oscillating', 0, t, T_trig);
          expect(stop.pos.x).toBeCloseTo(0, 12);
          expect(stop.pos.y).toBeCloseTo(0, 12);
          expect(stop.vel.x).toBeCloseTo(0, 12);
          expect(stop.vel.y).toBeCloseTo(0, 12);
          expect(stop.accel.x).toBeCloseTo(0, 12);
          expect(stop.accel.y).toBeCloseTo(0, 12);
        }
      });
    });
  }
});

describe('sampleStoppedHarmonicState: dipole brake (per-charge)', () => {
  const TB = SUDDEN_STOP_T_BRAKE;
  const T_trig = 0.3; // arbitrary mid-phase trigger
  const brakeEnd = T_trig + TB;

  for (const chargeIndex of [0, 1] as const) {
    const sign = chargeIndex === 0 ? +1 : -1;
    const rEqX = sign * DIPOLE_SEPARATION / 2;

    it(`charge ${chargeIndex}: ends at equilibrium (${rEqX}, 0) with v=0`, () => {
      const stop = sampleStoppedHarmonicState('dipole', chargeIndex, brakeEnd + 0.1, T_trig);
      expect(stop.pos.x).toBeCloseTo(rEqX, 12);
      expect(stop.pos.y).toBeCloseTo(0, 12);
      expect(stop.vel.x).toBeCloseTo(0, 12);
      expect(stop.vel.y).toBeCloseTo(0, 12);
      expect(stop.accel.x).toBeCloseTo(0, 12);
      expect(stop.accel.y).toBeCloseTo(0, 12);
    });

    it(`charge ${chargeIndex}: pre-trigger matches sampleDemoChargeStates`, () => {
      for (const t of [-0.1, 0, T_trig - 1e-9]) {
        const stop = sampleStoppedHarmonicState('dipole', chargeIndex, t, T_trig);
        const orig = sampleDemoChargeStates('dipole', t)[chargeIndex].state;
        expect(stop.pos.x).toBeCloseTo(orig.pos.x, 12);
        expect(stop.vel.x).toBeCloseTo(orig.vel.x, 12);
        expect(stop.accel.x).toBeCloseTo(orig.accel.x, 12);
      }
    });
  }
});

describe('sampleStoppedHarmonicState: water modes — COM conservation through brake', () => {
  // Mass-weighted COM must stay at origin in all three phases for every
  // water mode. The Hermite cubic preserves COM by construction (all charges
  // share f(τ)) and the brake-phase formula must respect that.
  const TB = SUDDEN_STOP_T_BRAKE;
  const T_trig = 0.4;
  const brakeEnd = T_trig + TB;
  const TRIG_AND_OFFSETS = [
    { label: 'pre',     t: T_trig - 0.05 },
    { label: 'τ=0.25',  t: T_trig + TB * 0.25 },
    { label: 'τ=0.75',  t: T_trig + TB * 0.75 },
    { label: 'post',    t: brakeEnd + 0.1 },
  ];

  for (const mode of ['water_stretch', 'water_bend', 'water_asym_stretch'] as const) {
    for (const { label, t } of TRIG_AND_OFFSETS) {
      it(`${mode} @ ${label}: m_O·r_O + m_H·(r_H+ + r_H-) ≈ 0`, () => {
        const specs = [0, 1, 2].map(ci =>
          sampleStoppedHarmonicState(mode, ci, t, T_trig)
        );
        const comX = WATER_M_O * specs[0].pos.x + WATER_M_H * (specs[1].pos.x + specs[2].pos.x);
        const comY = WATER_M_O * specs[0].pos.y + WATER_M_H * (specs[1].pos.y + specs[2].pos.y);
        expect(comX).toBeCloseTo(0, 10);
        expect(comY).toBeCloseTo(0, 10);
      });
    }
  }
});

describe('sampleStoppedHarmonicState: water modes — terminal config = equilibrium', () => {
  const TB = SUDDEN_STOP_T_BRAKE;
  const T_trig = 0.4;
  const brakeEnd = T_trig + TB;

  for (const mode of ['water_stretch', 'water_bend', 'water_asym_stretch'] as const) {
    it(`${mode}: every charge sits at its equilibrium position past brakeEnd`, () => {
      const o  = sampleStoppedHarmonicState(mode, 0, brakeEnd + 0.5, T_trig);
      const hp = sampleStoppedHarmonicState(mode, 1, brakeEnd + 0.5, T_trig);
      const hm = sampleStoppedHarmonicState(mode, 2, brakeEnd + 0.5, T_trig);
      expect(o.pos.x).toBeCloseTo(0, 12);
      expect(o.pos.y).toBeCloseTo(WATER_O_EQ_Y, 12);
      expect(hp.pos.x).toBeCloseTo(+WATER_H_EQ_X, 12);
      expect(hp.pos.y).toBeCloseTo(WATER_H_EQ_Y, 12);
      expect(hm.pos.x).toBeCloseTo(-WATER_H_EQ_X, 12);
      expect(hm.pos.y).toBeCloseTo(WATER_H_EQ_Y, 12);
      // All velocities and accelerations are zero.
      for (const s of [o, hp, hm]) {
        expect(s.vel.x).toBe(0); expect(s.vel.y).toBe(0);
        expect(s.accel.x).toBe(0); expect(s.accel.y).toBe(0);
      }
    });
  }
});

describe('sampleStoppedHydrogenState', () => {
  const TB = SUDDEN_STOP_T_BRAKE;
  const R = HYDROGEN_ORBIT_RADIUS;
  const W = HYDROGEN_OMEGA;

  it('charge 0 (central +q) is at rest at the origin in all phases', () => {
    const T_trig = 1.0;
    for (const t of [-1, 0, T_trig - 0.1, T_trig, T_trig + TB / 2, T_trig + TB, T_trig + 2]) {
      const s = sampleStoppedHydrogenState(0, t, T_trig);
      expect(s.pos.x).toBe(0); expect(s.pos.y).toBe(0);
      expect(s.vel.x).toBe(0); expect(s.vel.y).toBe(0);
      expect(s.accel.x).toBe(0); expect(s.accel.y).toBe(0);
    }
  });

  describe('charge 1 (orbiting -q)', () => {
    const T_trig = 1.2; // arbitrary mid-orbit
    const brakeEnd = T_trig + TB;

    it('pre-trigger matches sampleDemoChargeStates orbital state', () => {
      for (const t of [-0.5, 0, T_trig - 1e-9]) {
        const stop = sampleStoppedHydrogenState(1, t, T_trig);
        const orig = sampleDemoChargeStates('hydrogen', t)[1].state;
        expect(stop.pos.x).toBeCloseTo(orig.pos.x, 12);
        expect(stop.pos.y).toBeCloseTo(orig.pos.y, 12);
        expect(stop.vel.x).toBeCloseTo(orig.vel.x, 12);
        expect(stop.vel.y).toBeCloseTo(orig.vel.y, 12);
        expect(stop.accel.x).toBeCloseTo(orig.accel.x, 12);
        expect(stop.accel.y).toBeCloseTo(orig.accel.y, 12);
      }
    });

    it('continuity at T_trig: pos and vel match across the trigger', () => {
      const before = sampleStoppedHydrogenState(1, T_trig - 1e-9, T_trig);
      const at     = sampleStoppedHydrogenState(1, T_trig,        T_trig);
      expect(at.pos.x).toBeCloseTo(before.pos.x, 6);
      expect(at.pos.y).toBeCloseTo(before.pos.y, 6);
      expect(at.vel.x).toBeCloseTo(before.vel.x, 6);
      expect(at.vel.y).toBeCloseTo(before.vel.y, 6);
    });

    it('brake phase: ω_eff ramps linearly to 0; vel is tangential with magnitude R·ω_eff', () => {
      // At Δt = TB/2, ω_eff = ω_0/2.
      const t = T_trig + TB / 2;
      const stop = sampleStoppedHydrogenState(1, t, T_trig);
      const speed = Math.hypot(stop.vel.x, stop.vel.y);
      const expectedSpeed = R * (W / 2);
      expect(speed).toBeCloseTo(expectedSpeed, 10);
      // Velocity is tangent to the radial direction: vel · pos = 0.
      const dot = stop.vel.x * stop.pos.x + stop.vel.y * stop.pos.y;
      expect(dot).toBeCloseTo(0, 10);
    });

    it('brake phase: accel has both centripetal (≈ -R·ω_eff²·r̂) and tangential (≈ R·α·θ̂) components', () => {
      const t = T_trig + TB / 4;
      const stop = sampleStoppedHydrogenState(1, t, T_trig);
      // Reconstruct the expected accel from the documented closed form.
      const dt = t - T_trig;
      const omegaEff = W * (1 - dt / TB);
      const alpha = -W / TB;
      const theta = W * T_trig + W * dt - W * dt * dt / (2 * TB);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const expectedAx = -R * alpha * sin - R * omegaEff * omegaEff * cos;
      const expectedAy =  R * alpha * cos - R * omegaEff * omegaEff * sin;
      expect(stop.accel.x).toBeCloseTo(expectedAx, 10);
      expect(stop.accel.y).toBeCloseTo(expectedAy, 10);
    });

    it('left limit at brakeEnd: pos = R·(cos θ_f, sin θ_f), vel = 0, accel tangential-only (nonzero)', () => {
      const thetaF = W * T_trig + W * TB / 2;
      const stop = sampleStoppedHydrogenState(1, brakeEnd - 1e-9, T_trig);
      expect(stop.pos.x).toBeCloseTo(R * Math.cos(thetaF), 6);
      expect(stop.pos.y).toBeCloseTo(R * Math.sin(thetaF), 6);
      expect(Math.hypot(stop.vel.x, stop.vel.y)).toBeLessThan(1e-5);
      // Acceleration is the tangential decel R·α·(-sin θ_f, cos θ_f); centripetal piece is ≈ 0.
      const alpha = -W / TB;
      expect(stop.accel.x).toBeCloseTo(-R * alpha * Math.sin(thetaF), 4);
      expect(stop.accel.y).toBeCloseTo( R * alpha * Math.cos(thetaF), 4);
    });

    it('exact brakeEnd and beyond: full rest at θ_f', () => {
      const thetaF = W * T_trig + W * TB / 2;
      for (const t of [brakeEnd, brakeEnd + 1e-9, brakeEnd + 0.5, brakeEnd + 5]) {
        const stop = sampleStoppedHydrogenState(1, t, T_trig);
        expect(stop.pos.x).toBeCloseTo(R * Math.cos(thetaF), 12);
        expect(stop.pos.y).toBeCloseTo(R * Math.sin(thetaF), 12);
        expect(stop.vel.x).toBe(0); expect(stop.vel.y).toBe(0);
        expect(stop.accel.x).toBe(0); expect(stop.accel.y).toBe(0);
      }
    });
  });
});

describe('sampleStoppedDemoChargeStates: dispatch sanity', () => {
  // For every stoppable mode, the dispatch at t < T_trig must equal the
  // original pre-stop sampler element-wise. This is the contract that lets
  // the c-rebuilder walk back across the trigger boundary safely.
  const STOPPABLE_MODES = [
    'moving_charge',
    'oscillating',
    'dipole',
    'hydrogen',
    'water_stretch',
    'water_bend',
    'water_asym_stretch',
  ] as const;

  for (const mode of STOPPABLE_MODES) {
    it(`${mode}: t < T_trig matches sampleDemoChargeStates element-wise`, () => {
      const T_trig = 1.5;
      for (const t of [-0.5, 0, 0.5, T_trig - 1e-9]) {
        const stop = sampleStoppedDemoChargeStates(mode, t, T_trig);
        const orig = sampleDemoChargeStates(mode, t);
        expect(stop.length).toBe(orig.length);
        for (let ci = 0; ci < orig.length; ci++) {
          expect(stop[ci].charge).toBe(orig[ci].charge);
          expect(stop[ci].state.pos.x).toBeCloseTo(orig[ci].state.pos.x, 10);
          expect(stop[ci].state.pos.y).toBeCloseTo(orig[ci].state.pos.y, 10);
          expect(stop[ci].state.vel.x).toBeCloseTo(orig[ci].state.vel.x, 10);
          expect(stop[ci].state.vel.y).toBeCloseTo(orig[ci].state.vel.y, 10);
          expect(stop[ci].state.accel.x).toBeCloseTo(orig[ci].state.accel.x, 10);
          expect(stop[ci].state.accel.y).toBeCloseTo(orig[ci].state.accel.y, 10);
        }
      }
    });
  }

  it('moving_charge: matches sampleSuddenStopState directly', () => {
    const T_trig = 0.5;
    for (const t of [-0.1, T_trig - 1e-9, T_trig + 0.05, T_trig + SUDDEN_STOP_T_BRAKE + 1]) {
      const stop = sampleStoppedDemoChargeStates('moving_charge', t, T_trig);
      const direct = sampleSuddenStopState(t, T_trig);
      expect(stop.length).toBe(1);
      expect(stop[0].charge).toBe(1);
      expect(stop[0].state.pos.x).toBeCloseTo(direct.pos.x, 12);
      expect(stop[0].state.vel.x).toBeCloseTo(direct.vel.x, 12);
      expect(stop[0].state.accel.x).toBeCloseTo(direct.accel.x, 12);
    }
  });
});


// demoModes.ts — analytical source-state definitions for each demo mode.
//
// Pure functions only — no React, no canvas, no DOM.
// Each demo mode has a closed-form KinematicState for any t, including negative t
// (needed for history seeding before sim time = 0).

import type { KinematicState } from './types';

export type DemoMode = 'moving_charge' | 'oscillating' | 'draggable' | 'dipole' | 'hydrogen' | 'water_stretch' | 'water_bend';

// ─── sudden_stop constants ───────────────────────────────────────────────────

export const SUDDEN_STOP_V = 0.6;          // initial speed (world units / s)
export const SUDDEN_STOP_T_STOP = 2.0;     // default brakeStartTime used by scripted path (s)
export const SUDDEN_STOP_T_BRAKE = 0.2;    // braking duration (s)
export const SUDDEN_STOP_BRAKE_SUBSTEP_DT = 0.025; // max substep spacing within braking window (s)

/**
 * x-position where the charge comes to rest when braking begins at SUDDEN_STOP_T_STOP.
 * = V*T_STOP + average of (V + 0)/2 * T_BRAKE = V*T_STOP + V*T_BRAKE/2
 * Exported for tests that reference the scripted-stop resting position directly.
 */
export const SUDDEN_STOP_X_STOP =
  SUDDEN_STOP_V * SUDDEN_STOP_T_STOP + SUDDEN_STOP_V * SUDDEN_STOP_T_BRAKE / 2; // ≈ 1.26

// ─── oscillating constants ───────────────────────────────────────────────────

export const OSCILLATING_AMPLITUDE = 0.125; // world units
export const OSCILLATING_OMEGA     = 4.0;   // rad/s — peak speed = A·ω = 0.5, peak accel = A·ω² = 2.0

// ─── dipole constants ────────────────────────────────────────────────────────
//
// Collinear oscillating electric dipole: two opposite charges on the x-axis,
// each oscillating in opposite x-directions so the dipole moment p(t) is purely
// along x with no static offset.
//
// Charge 0 (+q): x = +DIPOLE_SEPARATION/2 + A·sin(ω·t),  y = 0
// Charge 1 (−q): x = −DIPOLE_SEPARATION/2 − A·sin(ω·t),  y = 0
//
// Separation constraint: DIPOLE_SEPARATION > 2·DIPOLE_AMPLITUDE (charges never cross).
// Peak speed per charge = DIPOLE_AMPLITUDE·DIPOLE_OMEGA = 0.5, same as oscillating.
export const DIPOLE_SEPARATION = 1.0;   // world units (equilibrium separation)
export const DIPOLE_AMPLITUDE  = OSCILLATING_AMPLITUDE; // 0.125 world units
export const DIPOLE_OMEGA      = OSCILLATING_OMEGA;     // 4.0 rad/s

// ─── hydrogen constants ──────────────────────────────────────────────────────
//
// Toy hydrogen-like atom: a fixed central positive charge and a negative charge
// in prescribed circular motion. This is not self-consistent orbital dynamics;
// it is an analytic source motion that lets students see radiation from a
// rotating electric dipole without introducing many-body forces.
//
// Charge 0 (+q): fixed at origin.
// Charge 1 (−q): r(t) = R·(cos(ωt), sin(ωt)).
//
// Peak speed = R·ω = 0.6, matching moving_charge's c-slider lower-bound regime.
export const HYDROGEN_ORBIT_RADIUS = 0.75; // world units
export const HYDROGEN_OMEGA        = 0.8;  // rad/s; peak speed = 0.6

// ─── water molecule constants ────────────────────────────────────────────────
//
// Three-charge H₂O-like source for two vibrational normal modes (M14):
// `water_stretch` (symmetric stretch) and `water_bend` (scissoring). Each mode
// modulates the time-varying dipole moment along the C₂ symmetry axis, so
// both are 2D-IR-active and produce dipole-pattern radiation.
//
// Charge index ordering is [O, H₊x, H₋x] (indices 0, 1, 2). This ordering
// must be preserved across all t because the WebGL history-texture slot
// assignments depend on it (per-charge texel slices are persistent across
// frames; reordering would invalidate the persisted history).
//
// Equilibrium geometry: O at origin; H atoms at
// (±sin(θ₀/2)·L₀, −cos(θ₀/2)·L₀). C₂ axis along y; H atoms hang below O so
// the molecule reads like a textbook drawing. Equilibrium dipole points
// along −y with magnitude 2·|q_H|·L₀·cos(θ₀/2).
//
// Approximation: oxygen is held FIXED at the origin for both modes. This is
// scripted teaching motion, not normal-coordinate mass-weighted COM-conserving
// molecular dynamics — in real H₂O all three atoms move and the COM is
// conserved. Holding O fixed keeps the kinematics closed-form and the
// dipole-radiation story unchanged for pedagogy. (Same precedent as hydrogen
// mode, which holds the central +q fixed instead of solving Coulomb orbital
// dynamics.)
//
// Frequency choice: real H₂O symmetric stretch (~3657 cm⁻¹) is about 2.3×
// the bend frequency (~1595 cm⁻¹). We use 2.0× (stretch ω = 4.0,
// bend ω = 2.0) to keep the IR-spectroscopy intuition that vibrational
// modes have characteristic frequencies, while keeping the bend mode
// visually responsive in sandbox time.
//
// Peak speeds for both modes are ≤ 0.5, so both share `CMIN_OSCILLATING`:
//   stretch: peak |dH/dt| = A·ω = 0.4
//   bend:    peak |dH/dt| = L₀·Δθ·ω/2 = 0.18
export const WATER_O_CHARGE             = -0.8;
export const WATER_H_CHARGE             = +0.4;
export const WATER_BOND_LENGTH          = 0.6;                    // L₀, world units
export const WATER_HOH_ANGLE_RAD        = (105 * Math.PI) / 180;  // θ₀ ≈ 1.833 rad

export const WATER_STRETCH_AMPLITUDE    = 0.1;   // A, fraction of L₀ added to bond length
export const WATER_STRETCH_OMEGA        = 4.0;   // rad/s; T_stretch ≈ π/2 ≈ 1.57 s

export const WATER_BEND_AMPLITUDE_RAD   = 0.3;   // Δθ ≈ 17°
export const WATER_BEND_OMEGA           = 2.0;   // rad/s; T_bend ≈ π ≈ 3.14 s

// ─── sampleSuddenStopState ───────────────────────────────────────────────────

/**
 * Exact three-phase kinematics for sudden_stop given a caller-supplied brakeStartTime.
 *
 * Phase 1 (t < brakeStartTime):                   uniform motion at SUDDEN_STOP_V
 * Phase 2 (brakeStartTime ≤ t < brakeStartTime+T_BRAKE): constant deceleration −V/T_BRAKE
 * Phase 3 (t ≥ brakeStartTime+T_BRAKE):            at rest at the Phase 2 end position
 *
 * Called by sampleSourceState('sudden_stop', t) with brakeStartTime = SUDDEN_STOP_T_STOP
 * (scripted path), and by the interactive tick path with the user-supplied trigger time.
 * Keeping the real logic here prevents the two paths from diverging.
 */
export function sampleSuddenStopState(t: number, brakeStartTime: number): KinematicState {
  const brakeAccel = -SUDDEN_STOP_V / SUDDEN_STOP_T_BRAKE; // = −3 units/s²
  const brakeEnd   = brakeStartTime + SUDDEN_STOP_T_BRAKE;
  // Resting x-position: depends on brakeStartTime, not SUDDEN_STOP_T_STOP.
  const xStop = SUDDEN_STOP_V * brakeStartTime + SUDDEN_STOP_V * SUDDEN_STOP_T_BRAKE / 2;

  if (t < brakeStartTime) {
    // Phase 1: uniform motion
    return {
      t,
      pos: { x: SUDDEN_STOP_V * t, y: 0 },
      vel: { x: SUDDEN_STOP_V, y: 0 },
      accel: { x: 0, y: 0 },
    };
  }

  if (t < brakeEnd) {
    // Phase 2: constant deceleration
    const elapsed = t - brakeStartTime;
    return {
      t,
      pos: {
        x: SUDDEN_STOP_V * brakeStartTime
          + SUDDEN_STOP_V * elapsed
          + 0.5 * brakeAccel * elapsed * elapsed,
        y: 0,
      },
      vel: { x: SUDDEN_STOP_V + brakeAccel * elapsed, y: 0 },
      accel: { x: brakeAccel, y: 0 },
    };
  }

  // Phase 3: at rest
  return {
    t,
    pos: { x: xStop, y: 0 },
    vel: { x: 0, y: 0 },
    accel: { x: 0, y: 0 },
  };
}

// ─── sampleSourceState ───────────────────────────────────────────────────────

/**
 * Return the exact KinematicState for the given demo mode at simulation time t.
 *
 * Valid for any t, including negative t (history seeding). All branches are
 * closed-form — no iteration, no history buffer needed.
 *
 * sudden_stop delegates to sampleSuddenStopState with the scripted brakeStartTime
 * (SUDDEN_STOP_T_STOP). The interactive tick path calls sampleSuddenStopState
 * directly with the user-supplied trigger time.
 *
 * Multi-charge modes are excluded and must be accessed via sampleDemoChargeStates.
 */
export function sampleSourceState(mode: Exclude<DemoMode, 'dipole' | 'hydrogen'>, t: number): KinematicState {
  // draggable: live tick bypasses sampleSourceState entirely and reads from drag refs.
  // This branch exists only to satisfy exhaustiveness and provides the zeroed at-rest
  // baseline (Coulomb field) used when the simulation is paused or freshly seeded.
  if (mode === 'draggable') {
    return { t, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
  }

  // moving_charge: pre-stop baseline is constant velocity at SUDDEN_STOP_V.
  // The stop event is runtime-controlled; post-trigger braking uses sampleSuddenStopState.
  if (mode === 'moving_charge') {
    return {
      t,
      pos: { x: SUDDEN_STOP_V * t, y: 0 },
      vel: { x: SUDDEN_STOP_V, y: 0 },
      accel: { x: 0, y: 0 },
    };
  }

  // oscillating: x = A·sin(ω·t), sinusoidal motion along x-axis.
  // Peak speed = A·ω = 0.5 world units/s, safely below the c-slider minimum (0.65).
  const x  = OSCILLATING_AMPLITUDE * Math.sin(OSCILLATING_OMEGA * t);
  const vx = OSCILLATING_AMPLITUDE * OSCILLATING_OMEGA * Math.cos(OSCILLATING_OMEGA * t);
  const ax = -OSCILLATING_AMPLITUDE * OSCILLATING_OMEGA ** 2 * Math.sin(OSCILLATING_OMEGA * t);
  return { t, pos: { x, y: 0 }, vel: { x: vx, y: 0 }, accel: { x: ax, y: 0 } };
}

// ─── sampleDemoChargeStates ──────────────────────────────────────────────────

/** One charge's spec: signed charge value + kinematic state at a given time. */
export type DemoChargeSpec = {
  charge: number;
  state: KinematicState;
};

/**
 * Exact kinematic state for one dipole charge at simulation time t.
 * chargeIndex 0 = positive (+q), chargeIndex 1 = negative (−q).
 * Both closed-form for any t, including negative t (history seeding).
 */
function sampleDipoleState(chargeIndex: 0 | 1, t: number): KinematicState {
  const sign = chargeIndex === 0 ? 1 : -1;
  const half = DIPOLE_SEPARATION / 2;
  const x   = sign * half + sign * DIPOLE_AMPLITUDE * Math.sin(DIPOLE_OMEGA * t);
  const vx  = sign * DIPOLE_AMPLITUDE * DIPOLE_OMEGA * Math.cos(DIPOLE_OMEGA * t);
  const ax  = -sign * DIPOLE_AMPLITUDE * DIPOLE_OMEGA ** 2 * Math.sin(DIPOLE_OMEGA * t);
  return { t, pos: { x, y: 0 }, vel: { x: vx, y: 0 }, accel: { x: ax, y: 0 } };
}

/**
 * Exact kinematic state for the hydrogen-like two-charge toy model.
 * chargeIndex 0 = central positive charge, chargeIndex 1 = orbiting negative charge.
 */
function sampleHydrogenState(chargeIndex: 0 | 1, t: number): KinematicState {
  if (chargeIndex === 0) {
    return { t, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
  }

  const theta = HYDROGEN_OMEGA * t;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const r = HYDROGEN_ORBIT_RADIUS;
  const omega = HYDROGEN_OMEGA;

  return {
    t,
    pos: { x: r * cos, y: r * sin },
    vel: { x: -r * omega * sin, y: r * omega * cos },
    accel: { x: -r * omega * omega * cos, y: -r * omega * omega * sin },
  };
}

/**
 * Exact kinematic state for the water symmetric-stretch mode.
 *
 * Charge index ordering: 0 = O (fixed at origin), 1 = H₊x, 2 = H₋x.
 *
 * Both bond lengths breathe in phase: L(t) = L₀ + A·sin(ω·t). The H atoms
 * move radially along their respective bond directions at fixed angle θ₀/2
 * from the C₂ axis, mirrored across that axis.
 *
 * H₊x position: ( L(t)·sin(θ₀/2),  −L(t)·cos(θ₀/2) )
 * H₋x position: (−L(t)·sin(θ₀/2),  −L(t)·cos(θ₀/2) )
 *
 * Velocity and acceleration follow analytically from dL/dt and d²L/dt².
 */
function sampleWaterStretchState(chargeIndex: 0 | 1 | 2, t: number): KinematicState {
  if (chargeIndex === 0) {
    return { t, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
  }

  const halfAngle = WATER_HOH_ANGLE_RAD / 2;
  const sinHalf   = Math.sin(halfAngle);
  const cosHalf   = Math.cos(halfAngle);
  const sign      = chargeIndex === 1 ? +1 : -1;  // index 1 → +x, index 2 → −x

  const A = WATER_STRETCH_AMPLITUDE;
  const w = WATER_STRETCH_OMEGA;
  const L  = WATER_BOND_LENGTH + A * Math.sin(w * t);
  const Lp = A * w * Math.cos(w * t);                // dL/dt
  const Lpp = -A * w * w * Math.sin(w * t);          // d²L/dt²

  return {
    t,
    pos:   { x:  sign * L   * sinHalf, y: -L   * cosHalf },
    vel:   { x:  sign * Lp  * sinHalf, y: -Lp  * cosHalf },
    accel: { x:  sign * Lpp * sinHalf, y: -Lpp * cosHalf },
  };
}

/**
 * Exact kinematic state for the water bend (scissoring) mode.
 *
 * Charge index ordering: 0 = O (fixed at origin), 1 = H₊x, 2 = H₋x.
 *
 * Bond lengths are fixed at L₀; the H–O–H angle modulates as
 * θ(t) = θ₀ + Δθ·sin(ω·t). Each H atom moves along an arc of radius L₀
 * around O. The mirror symmetry across the C₂ axis is preserved at all t.
 *
 * H₊x position: (  L₀·sin(θ(t)/2), −L₀·cos(θ(t)/2) )
 * H₋x position: ( −L₀·sin(θ(t)/2), −L₀·cos(θ(t)/2) )
 *
 * Let φ(t) = θ(t)/2. Then by the chain rule:
 *   dx/dt    = ±L₀·cos(φ)·φ'
 *   d²x/dt²  = ±L₀·(−sin(φ)·(φ')² + cos(φ)·φ'')
 *   dy/dt    =  L₀·sin(φ)·φ'
 *   d²y/dt²  =  L₀·(cos(φ)·(φ')² + sin(φ)·φ'')
 * where φ' = (Δθ·ω/2)·cos(ω·t) and φ'' = −(Δθ·ω²/2)·sin(ω·t).
 */
function sampleWaterBendState(chargeIndex: 0 | 1 | 2, t: number): KinematicState {
  if (chargeIndex === 0) {
    return { t, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
  }

  const sign = chargeIndex === 1 ? +1 : -1;
  const L    = WATER_BOND_LENGTH;
  const D    = WATER_BEND_AMPLITUDE_RAD;
  const w    = WATER_BEND_OMEGA;

  const theta   = WATER_HOH_ANGLE_RAD + D * Math.sin(w * t);
  const phi     = theta / 2;
  const sinPhi  = Math.sin(phi);
  const cosPhi  = Math.cos(phi);

  const phiP    = (D * w / 2) * Math.cos(w * t);            // dφ/dt
  const phiPP   = -(D * w * w / 2) * Math.sin(w * t);       // d²φ/dt²

  // y-component: H_y = -L·cos(φ). Note the sign flips when differentiating cos.
  //   dH_y/dt   =  L·sin(φ)·φ'
  //   d²H_y/dt² =  L·(cos(φ)·(φ')² + sin(φ)·φ'')
  // x-component: H_x = sign·L·sin(φ).
  //   dH_x/dt   = sign·L·cos(φ)·φ'
  //   d²H_x/dt² = sign·L·(−sin(φ)·(φ')² + cos(φ)·φ'')
  return {
    t,
    pos:   { x:  sign * L * sinPhi,                                 y: -L * cosPhi                                  },
    vel:   { x:  sign * L * cosPhi * phiP,                          y:  L * sinPhi * phiP                           },
    accel: { x:  sign * L * (-sinPhi * phiP * phiP + cosPhi * phiPP), y:  L * (cosPhi * phiP * phiP + sinPhi * phiPP) },
  };
}

/**
 * Return the charge specs for all charges in `mode` at simulation time t.
 *
 * Single-charge modes return a length-1 array. Multi-charge modes return a
 * length-2 array with charge values +1 (index 0) and −1 (index 1).
 *
 * For `draggable` and `moving_charge`, the kinematic state is the analytic
 * baseline — the tick loop overrides it with drag refs / stop-trigger logic
 * respectively. Callers that need the live tick state should read from the
 * history refs, not from this function.
 */
export function sampleDemoChargeStates(mode: DemoMode, t: number): DemoChargeSpec[] {
  if (mode === 'dipole') {
    return [
      { charge: +1, state: sampleDipoleState(0, t) },
      { charge: -1, state: sampleDipoleState(1, t) },
    ];
  }
  if (mode === 'hydrogen') {
    return [
      { charge: +1, state: sampleHydrogenState(0, t) },
      { charge: -1, state: sampleHydrogenState(1, t) },
    ];
  }
  // Water modes: charges are returned in the locked order [O, H₊x, H₋x] so
  // the WebGL history-texture slot assignments stay stable across frames.
  if (mode === 'water_stretch') {
    return [
      { charge: WATER_O_CHARGE, state: sampleWaterStretchState(0, t) },
      { charge: WATER_H_CHARGE, state: sampleWaterStretchState(1, t) },
      { charge: WATER_H_CHARGE, state: sampleWaterStretchState(2, t) },
    ];
  }
  if (mode === 'water_bend') {
    return [
      { charge: WATER_O_CHARGE, state: sampleWaterBendState(0, t) },
      { charge: WATER_H_CHARGE, state: sampleWaterBendState(1, t) },
      { charge: WATER_H_CHARGE, state: sampleWaterBendState(2, t) },
    ];
  }
  return [{ charge: 1, state: sampleSourceState(mode, t) }];
}

// ─── maxHistorySpeed ─────────────────────────────────────────────────────────

/**
 * Peak speed (world units / s) ever reached by this mode.
 *
 * Used to compute the velocity-aware history horizon:
 *   maxCornerDist(pos, viewBounds) / (c − maxHistorySpeed(mode))
 *
 * For sudden_stop this returns SUDDEN_STOP_V even after the charge has stopped,
 * so the history buffer retains the pre-stop moving history that outside-shell
 * observers need (effective travel time R/(c−V), not R/c).
 *
 * M3 ASSUMPTION: SUDDEN_STOP_V < config.c (holds when c ≥ 0.65 and V = 0.6).
 * M5 adds a c slider (SPEC.md:138); demo speeds are defined to stay below the slider min.
 */
export function maxHistorySpeed(mode: DemoMode): number {
  // draggable: speed is dynamic and tracked via dragPeakSpeedRef in the sandbox.
  // Return 0 here; the tick uses dragPeakSpeedRef directly for the horizon calculation.
  if (mode === 'draggable') return 0;
  if (mode === 'oscillating' || mode === 'dipole') return OSCILLATING_AMPLITUDE * OSCILLATING_OMEGA; // 0.5
  if (mode === 'hydrogen') return HYDROGEN_ORBIT_RADIUS * HYDROGEN_OMEGA; // 0.6
  // Water modes: peak H-atom speed.
  //   stretch: |dH/dt|_max = A·ω
  //   bend:    |dH/dt|_max = L₀·Δθ·ω/2
  if (mode === 'water_stretch') return WATER_STRETCH_AMPLITUDE * WATER_STRETCH_OMEGA;                  // 0.4
  if (mode === 'water_bend')    return WATER_BOND_LENGTH * WATER_BEND_AMPLITUDE_RAD * WATER_BEND_OMEGA / 2; // 0.18
  return SUDDEN_STOP_V; // moving_charge peaks at SUDDEN_STOP_V (pre- and post-stop history)
}

// ─── brakingSubstepTimes ─────────────────────────────────────────────────────

/**
 * Return simulation times to record before the main recordState() call in the tick.
 *
 * Two categories are combined:
 *   1. Exact phase-boundary times — brakeStartTime and/or brakeStartTime+T_BRAKE — if they fall
 *      strictly inside (prevSimTime, currentSimTime). Recording these prevents
 *      ChargeHistory's linear interpolation from smearing the acceleration step
 *      across an entire frame interval, which would blur the shell edge.
 *   2. Interior substeps within the braking overlap at spacing ≤ SUDDEN_STOP_BRAKE_SUBSTEP_DT,
 *      making shell sharpness frame-rate-independent.
 *
 * All returned times are strictly in (prevSimTime, currentSimTime) and strictly
 * increasing. Returns [] when no braking overlap and no boundary falls in the window.
 *
 * The optional brakeStartTime parameter defaults to SUDDEN_STOP_T_STOP for the scripted
 * path; the interactive tick supplies the user-triggered stop time instead.
 */
export function brakingSubstepTimes(
  prevSimTime: number,
  currentSimTime: number,
  brakeStartTime: number = SUDDEN_STOP_T_STOP,
): number[] {
  const brakeEnd = brakeStartTime + SUDDEN_STOP_T_BRAKE;
  const result: number[] = [];

  // Stage 1: exact phase-boundary anchors
  if (prevSimTime < brakeStartTime && brakeStartTime < currentSimTime) result.push(brakeStartTime);
  if (prevSimTime < brakeEnd && brakeEnd < currentSimTime) result.push(brakeEnd);

  // Stage 2: interior substeps within braking overlap
  const subStart = Math.max(prevSimTime, brakeStartTime);
  const subEnd = Math.min(currentSimTime, brakeEnd);
  if (subStart < subEnd) {
    const n = Math.ceil((subEnd - subStart) / SUDDEN_STOP_BRAKE_SUBSTEP_DT);
    for (let i = 1; i < n; i++) { // i < n: excludes subEnd itself
      result.push(subStart + (subEnd - subStart) * i / n);
    }
  }

  return result.sort((a, b) => a - b);
}

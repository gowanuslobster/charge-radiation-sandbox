// demoModes.ts — analytical source-state definitions for each demo mode.
//
// Pure functions only — no React, no canvas, no DOM.
// Each demo mode has a closed-form KinematicState for any t, including negative t
// (needed for history seeding before sim time = 0).

import type { KinematicState } from './types';

export type DemoMode = 'moving_charge' | 'oscillating' | 'draggable' | 'dipole' | 'hydrogen';

/**
 * Magnetic-heatmap channel selector for the overlay.
 *
 *   'off'   — no magnetic heatmap (wavefront contour may still render independently)
 *   'total' — signed total Bz  = bZVel + bZAccel
 *   'vel'   — signed velocity (bound) Bz component
 *   'accel' — signed acceleration (radiative) Bz component; pedagogical successor
 *             of the pre-M11 absolute-value "Radiation heatmap"
 *
 * All three non-off channels render as signed warm/cool Bz; the wavefront
 * contour, when enabled, is always derived from bZAccel regardless of the
 * selected channel (it is a radiation annotation, not a magnetic isoline).
 */
export type MagneticHeatmapMode = 'off' | 'total' | 'vel' | 'accel';

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

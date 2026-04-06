// demoModes.ts — analytical source-state definitions for each demo mode.
//
// Pure functions only — no React, no canvas, no DOM.
// Each demo mode has a closed-form KinematicState for any t, including negative t
// (needed for history seeding before sim time = 0).

import type { KinematicState } from './types';

export type DemoMode = 'stationary' | 'uniform_velocity' | 'sudden_stop';

// ─── sudden_stop constants ───────────────────────────────────────────────────

export const SUDDEN_STOP_V = 0.6;          // initial speed (world units / s)
export const SUDDEN_STOP_T_STOP = 2.0;     // sim time when braking begins (s)
export const SUDDEN_STOP_T_BRAKE = 0.2;    // braking duration (s)
export const SUDDEN_STOP_BRAKE_SUBSTEP_DT = 0.025; // max substep spacing within braking window (s)

/**
 * x-position where the charge comes to rest.
 * = V*T_STOP + average of (V + 0)/2 * T_BRAKE = V*T_STOP + V*T_BRAKE/2
 */
export const SUDDEN_STOP_X_STOP =
  SUDDEN_STOP_V * SUDDEN_STOP_T_STOP + SUDDEN_STOP_V * SUDDEN_STOP_T_BRAKE / 2; // ≈ 1.26

// ─── sampleSourceState ───────────────────────────────────────────────────────

/**
 * Return the exact KinematicState for the given demo mode at simulation time t.
 *
 * Valid for any t, including negative t (history seeding). All branches are
 * closed-form — no iteration, no history buffer needed.
 *
 * sudden_stop three-phase kinematics:
 *   Phase 1 (t < T_STOP):         uniform motion at V
 *   Phase 2 (T_STOP ≤ t < T_STOP+T_BRAKE): constant deceleration −V/T_BRAKE
 *   Phase 3 (t ≥ T_STOP+T_BRAKE): at rest at X_STOP
 *
 * The nonzero acceleration in Phase 2 drives betaDot ≠ 0 in the LW evaluator,
 * producing a visible radiation shell in the eAccel field layer.
 */
export function sampleSourceState(mode: DemoMode, t: number): KinematicState {
  if (mode === 'stationary') {
    return { t, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
  }

  if (mode === 'uniform_velocity') {
    return {
      t,
      pos: { x: SUDDEN_STOP_V * t, y: 0 },
      vel: { x: SUDDEN_STOP_V, y: 0 },
      accel: { x: 0, y: 0 },
    };
  }

  // sudden_stop
  const brakeAccel = -SUDDEN_STOP_V / SUDDEN_STOP_T_BRAKE; // = −3 units/s²

  if (t < SUDDEN_STOP_T_STOP) {
    // Phase 1: uniform motion
    return {
      t,
      pos: { x: SUDDEN_STOP_V * t, y: 0 },
      vel: { x: SUDDEN_STOP_V, y: 0 },
      accel: { x: 0, y: 0 },
    };
  }

  if (t < SUDDEN_STOP_T_STOP + SUDDEN_STOP_T_BRAKE) {
    // Phase 2: constant deceleration
    const elapsed = t - SUDDEN_STOP_T_STOP;
    return {
      t,
      pos: {
        x: SUDDEN_STOP_V * SUDDEN_STOP_T_STOP
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
    pos: { x: SUDDEN_STOP_X_STOP, y: 0 },
    vel: { x: 0, y: 0 },
    accel: { x: 0, y: 0 },
  };
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
 * M3 ASSUMPTION: SUDDEN_STOP_V < config.c (holds when c = 1).
 * M5 adds a c slider (SPEC.md:138); if c becomes user-configurable, demo speeds
 * should be redefined relative to c or a speed >= c guard added to the horizon
 * calculation in the simulation tick.
 */
export function maxHistorySpeed(mode: DemoMode): number {
  if (mode === 'stationary') return 0;
  return SUDDEN_STOP_V; // uniform_velocity and sudden_stop both peak at SUDDEN_STOP_V
}

// ─── brakingSubstepTimes ─────────────────────────────────────────────────────

/**
 * Return simulation times to record before the main recordState() call in the tick.
 *
 * Two categories are combined:
 *   1. Exact phase-boundary times — T_STOP and/or T_STOP+T_BRAKE — if they fall
 *      strictly inside (prevSimTime, currentSimTime). Recording these prevents
 *      ChargeHistory's linear interpolation from smearing the acceleration step
 *      across an entire frame interval, which would blur the shell edge.
 *   2. Interior substeps within the braking overlap at spacing ≤ SUDDEN_STOP_BRAKE_SUBSTEP_DT,
 *      making shell sharpness frame-rate-independent.
 *
 * All returned times are strictly in (prevSimTime, currentSimTime) and strictly
 * increasing. Returns [] when no braking overlap and no boundary falls in the window.
 *
 * Dedup is not needed: boundary anchors sit exactly at subStart/subEnd while the
 * interior loop excludes those endpoints (i starts at 1, i < n) — no coincidence possible.
 */
export function brakingSubstepTimes(prevSimTime: number, currentSimTime: number): number[] {
  const brakeStart = SUDDEN_STOP_T_STOP;
  const brakeEnd = SUDDEN_STOP_T_STOP + SUDDEN_STOP_T_BRAKE;
  const result: number[] = [];

  // Stage 1: exact phase-boundary anchors
  if (prevSimTime < brakeStart && brakeStart < currentSimTime) result.push(brakeStart);
  if (prevSimTime < brakeEnd && brakeEnd < currentSimTime) result.push(brakeEnd);

  // Stage 2: interior substeps within braking overlap
  const subStart = Math.max(prevSimTime, brakeStart);
  const subEnd = Math.min(currentSimTime, brakeEnd);
  if (subStart < subEnd) {
    const n = Math.ceil((subEnd - subStart) / SUDDEN_STOP_BRAKE_SUBSTEP_DT);
    for (let i = 1; i < n; i++) { // i < n: excludes subEnd itself
      result.push(subStart + (subEnd - subStart) * i / n);
    }
  }

  return result.sort((a, b) => a - b);
}

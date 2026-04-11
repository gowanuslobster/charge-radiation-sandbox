// Liénard-Wiechert field evaluator for a single point charge.
//
// Computes the exact electromagnetic fields produced by an arbitrarily moving
// point charge, using its kinematic history to find the retarded source state.
//
// UNITS: Normalized (Gaussian-like) units with Coulomb constant k = 1.
//   E has units of [charge / length²] for the velocity term,
//   and [charge / (c · length)] for the acceleration term.
//   To convert to SI, multiply results by k_SI = 8.988e9 N·m²/C².
//
// COORDINATE SYSTEM: Standard Cartesian world space (+X right, +Y up).
//   All vectors are in the XY plane; B is out-of-plane (scalar z-component).
//
// References:
//   Jackson, Classical Electrodynamics, §14.1 (3rd ed.)
//   Griffiths, Introduction to Electrodynamics, §10.3

import type { LWFieldResult, RetardedSolveResult, SimConfig, Vec2 } from './types';
import { ChargeHistory } from './chargeHistory';
import { solveRetardedState } from './retardedTime';
import { add, cross2D, dot, magnitude, scale, subtract } from './vec2';

export type EvaluateLWParams = {
  observationPos: Vec2;
  observationTime: number;
  history: ChargeHistory;
  /** Charge magnitude (signed). Positive = positive charge. */
  charge: number;
  config: SimConfig;
};

/**
 * Compute the Liénard-Wiechert electric and magnetic fields from an already-solved
 * retarded state. Callers that have already run solveRetardedState (e.g. the wavefront
 * sampler, which manages its own tRet cache) should use this to avoid a redundant
 * internal solve — one solve per observation point, not two.
 *
 * Field decomposition:
 *   eVel   — velocity (Coulomb-like) term, 1/R² decay, always present
 *   eAccel — acceleration (radiation) term, 1/R decay, zero when accel = 0
 *   eTotal — eVel + eAccel
 *   bZ     — total out-of-plane B field: bZVel + bZAccel
 *   bZVel  — cross2D(nHat, eVel) / c
 *   bZAccel — cross2D(nHat, eAccel) / c  (radiative magnetic component)
 */
export function evaluateLWFieldFromState(
  solveResult: RetardedSolveResult,
  observationPos: Vec2,
  q: number,
  config: SimConfig,
): LWFieldResult {
  const c = config.c;
  const epsilon = config.softening ?? 0.01;
  const { state: retState } = solveResult;

  // --- Retarded displacement vector and softened distance ---
  const R_vec: Vec2 = subtract(observationPos, retState.pos);
  const R = magnitude(R_vec);
  const R_eff = Math.sqrt(R * R + epsilon * epsilon);

  // --- Unit vector from retarded source to observer ---
  const nHat: Vec2 = { x: R_vec.x / R_eff, y: R_vec.y / R_eff };

  // --- Normalized velocity and acceleration ---
  const beta: Vec2 = scale(retState.vel, 1 / c);
  const betaDot: Vec2 = scale(retState.accel, 1 / c);

  // --- Relativistic beaming denominator ---
  const kappa = 1 - dot(beta, nHat);
  const kappa3 = kappa * kappa * kappa;

  // --- Lorentz factor squared ---
  const MAX_BETA_SQ = 1 - 1e-6;
  const betaSq = Math.min(dot(beta, beta), MAX_BETA_SQ);
  const gammaSq = 1 / (1 - betaSq);

  // --- Velocity field (Coulomb-like, 1/R² decay) ---
  const nHatMinusBeta: Vec2 = subtract(nHat, beta);
  const velDenom = gammaSq * kappa3 * R_eff * R_eff;
  const eVel: Vec2 = scale(nHatMinusBeta, q / velDenom);

  // --- Acceleration field (radiation, 1/R decay) ---
  // 2D reduction of n̂ × ((n̂ - β) × β̇): see full derivation comment in git history.
  const s = cross2D(nHatMinusBeta, betaDot);
  const accelDir: Vec2 = { x: nHat.y * s, y: -nHat.x * s };
  const accelDenom = kappa3 * R_eff;
  const eAccel: Vec2 = scale(accelDir, q / (c * accelDenom));

  // --- Total electric field ---
  const eTotal: Vec2 = add(eVel, eAccel);

  // --- Magnetic field decomposition ---
  // bZ = cross2D(nHat, eTotal) / c, split into velocity and radiation components.
  const bZVel   = cross2D(nHat, eVel)   / c;
  const bZAccel = cross2D(nHat, eAccel) / c;
  const bZ      = bZVel + bZAccel;

  return { eVel, eAccel, eTotal, bZ, bZVel, bZAccel };
}

/**
 * Evaluate the Liénard-Wiechert electric and magnetic fields at a given
 * observation point and time, for a single charge with the given history.
 *
 * Returns null if history is empty (normal on the first frame).
 *
 * Field decomposition (see LWFieldResult in types.ts):
 *   eVel   — velocity (Coulomb-like) term, 1/R² decay, always present
 *   eAccel — acceleration (radiation) term, 1/R decay, zero when accel = 0
 *   eTotal — eVel + eAccel
 *   bZ / bZVel / bZAccel — magnetic field and its decomposition (see types.ts)
 */
export function evaluateLienardWiechertField(params: EvaluateLWParams): LWFieldResult | null {
  const { observationPos, observationTime, history, charge: q, config } = params;

  // --- Step 1: Find the retarded source state ---
  const solveResult = solveRetardedState({
    observationPos,
    observationTime,
    history,
    c: config.c,
  });
  if (solveResult === null) return null;

  return evaluateLWFieldFromState(solveResult, observationPos, q, config);
}

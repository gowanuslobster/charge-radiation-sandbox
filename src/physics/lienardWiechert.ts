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

import type { LWFieldResult, SimConfig, Vec2 } from './types';
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
 * Evaluate the Liénard-Wiechert electric and magnetic fields at a given
 * observation point and time, for a single charge with the given history.
 *
 * Returns null if history is empty (normal on the first frame).
 *
 * Field decomposition (see LWFieldResult in types.ts):
 *   eVel   — velocity (Coulomb-like) term, 1/R² decay, always present
 *   eAccel — acceleration (radiation) term, 1/R decay, zero when accel = 0
 *   eTotal — eVel + eAccel
 *   bZ     — out-of-plane B field: cross2D(nHat, eTotal) / c (physics contract)
 */
export function evaluateLienardWiechertField(params: EvaluateLWParams): LWFieldResult | null {
  const { observationPos, observationTime, history, charge: q, config } = params;
  const c = config.c;
  const epsilon = config.softening ?? 0.01;

  // --- Step 1: Find the retarded source state ---
  // The fields at (r_obs, t_obs) depend on the charge state at the retarded time
  // t_ret, when the signal that reaches r_obs at t_obs was emitted.
  const solveResult = solveRetardedState({
    observationPos,
    observationTime,
    history,
    c,
  });
  if (solveResult === null) return null;

  const { state: retState } = solveResult;

  // --- Step 2: Retarded displacement vector and softened distance ---
  // R_vec points from the retarded source position to the observation point.
  const R_vec: Vec2 = subtract(observationPos, retState.pos);
  const R = magnitude(R_vec);
  // Plummer softening prevents 1/R divergence near the charge.
  // R_eff = sqrt(R² + ε²). This is a standard regularization; label it as such.
  const R_eff = Math.sqrt(R * R + epsilon * epsilon);

  // --- Step 3: Unit vector from retarded source to observer ---
  const nHat: Vec2 = { x: R_vec.x / R_eff, y: R_vec.y / R_eff };

  // --- Step 4: Normalized velocity and acceleration ---
  // beta = v / c (dimensionless velocity)
  // betaDot = a / c (has units of 1/time, but we use it as a normalized acceleration)
  const beta: Vec2 = scale(retState.vel, 1 / c);
  const betaDot: Vec2 = scale(retState.accel, 1 / c);

  // --- Step 5: Relativistic beaming denominator ---
  // kappa = 1 - beta · nHat appears cubed in both field terms.
  // It encodes relativistic beaming: fields are compressed in the forward direction
  // (small kappa → large field) and diluted behind (large kappa → small field).
  const kappa = 1 - dot(beta, nHat);
  const kappa3 = kappa * kappa * kappa;

  // --- Step 6: Lorentz factor squared ---
  // gamma² = 1 / (1 - |beta|²). Used only in the velocity field term.
  //
  // Precondition: the caller must ensure |v| < c for all recorded states.
  // Superluminal inputs (betaSq >= 1) produce negative gammaSq, invalid fields, or NaN.
  // We clamp betaSq to MAX_BETA_SQ as a defensive measure, but callers should never
  // record states with |v| >= c. This clamp is not physically meaningful; it is a guard
  // against silent corruption. Label it explicitly so it is auditable.
  const MAX_BETA_SQ = 1 - 1e-6; // slightly below 1; gamma ≈ 707 at this limit
  const betaSq = Math.min(dot(beta, beta), MAX_BETA_SQ);
  const gammaSq = 1 / (1 - betaSq);

  // --- Step 7: Velocity field (Coulomb-like, 1/R² decay) ---
  // E_vel = k·q · (nHat - beta) / (gamma² · kappa³ · R_eff²)
  //
  // This is the generalization of the Coulomb field to a moving charge.
  // For a stationary charge (beta = 0, gamma = 1, kappa = 1), it reduces to
  //   E_vel = k·q · nHat / R², i.e., the ordinary Coulomb field.
  const nHatMinusBeta: Vec2 = subtract(nHat, beta);
  const velDenom = gammaSq * kappa3 * R_eff * R_eff;
  const eVel: Vec2 = scale(nHatMinusBeta, q / velDenom);

  // --- Step 8: Acceleration field (radiation, 1/R decay) ---
  // The 3D formula is: E_accel = (k·q / c) · [n̂ × ((n̂ - β) × β̇)] / (kappa³ · R_eff)
  //
  // Explicit 2D reduction (all vectors are in the XY plane):
  //   Inner cross (n̂ - β) × β̇ is a z-component scalar:
  //     s = cross2D(nHat - beta, betaDot)   [= (n̂-β)_x·β̇_y − (n̂-β)_y·β̇_x]
  //   Outer cross n̂ × (s·ẑ) is an in-plane vector.
  //   For n̂ = (nx, ny, 0) and s·ẑ = (0, 0, s):
  //     (nx, ny, 0) × (0, 0, s) = (ny·s − 0, 0 − nx·s, 0) = (ny·s, −nx·s, 0)
  //   So the 2D in-plane result is: s · (nHat.y, −nHat.x)
  //
  // Physical check: charge accelerating in +x, observer on +y (nHat ≈ (0,1)):
  //   s = cross2D((0,1), (a/c, 0)) = −a/c
  //   accelDir = (ny·s, −nx·s) = (1·(−a/c), −0·(−a/c)) = (−a/c, 0) → −x ✓
  //   (LW radiation always opposes the projected acceleration, as expected.)
  //
  // This is not an approximation; it is the exact 3D formula evaluated in the XY plane.
  const s = cross2D(nHatMinusBeta, betaDot);
  const accelDir: Vec2 = { x: nHat.y * s, y: -nHat.x * s };
  const accelDenom = kappa3 * R_eff;
  // k = 1 (normalized), and the acceleration term has an extra 1/c factor from LW derivation.
  const eAccel: Vec2 = scale(accelDir, q / (c * accelDenom));

  // --- Step 9: Total electric field ---
  const eTotal: Vec2 = add(eVel, eAccel);

  // --- Step 10: Magnetic field ---
  // In 3D: B = (1/c) · (n̂ × E), evaluated at the retarded position.
  // In 2D (E and n̂ in XY plane): B has only a z-component.
  //   bZ = cross2D(nHat, eTotal) / c
  //
  // This is the physics contract for B in this model. B is derived from eTotal,
  // not computed independently.
  const bZ = cross2D(nHat, eTotal) / c;

  return { eVel, eAccel, eTotal, bZ };
}

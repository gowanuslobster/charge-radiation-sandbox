// demoModes.ts — analytical source-state definitions for each demo mode.
//
// Pure functions only — no React, no canvas, no DOM.
// Each demo mode has a closed-form KinematicState for any t, including negative t
// (needed for history seeding before sim time = 0).

import type { KinematicState } from './types';

export type DemoMode = 'moving_charge' | 'oscillating' | 'draggable' | 'dipole' | 'hydrogen' | 'water_stretch' | 'water_bend' | 'water_asym_stretch';

// Multi-charge modes are the ones whose `sampleDemoChargeStates` branch returns
// multiple charges with their own per-charge sampleX(chargeIndex, t) helpers.
// They are NOT accessible through `sampleSourceState`, which is single-charge
// only. Listing them in one place lets the type system enforce that constraint
// for `sampleSourceState` (which would otherwise silently fall through to the
// oscillating branch for a multi-charge mode name).
type MultiChargeDemoMode = 'dipole' | 'hydrogen' | 'water_stretch' | 'water_bend' | 'water_asym_stretch';
type SingleChargeDemoMode = Exclude<DemoMode, MultiChargeDemoMode>;

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
// Three-charge H₂O-like source for two vibrational normal modes (M14, with
// COM-conserving motion landed in M15-A):
// `water_stretch` (symmetric stretch) and `water_bend` (scissoring). Each mode
// modulates the time-varying dipole moment along the C₂ symmetry axis, so
// both are 2D-IR-active and produce dipole-pattern radiation.
//
// Charge index ordering is [O, H₊x, H₋x] (indices 0, 1, 2). This ordering
// must be preserved across all t because the WebGL history-texture slot
// assignments depend on it (per-charge texel slices are persistent across
// frames; reordering would invalidate the persisted history).
//
// Mass-weighted COM at the world origin (M15-A): each mode's δ vectors are
// constructed so that m_O·δ_O + m_H·(δ_H+ + δ_H-) = 0 by construction. All
// three atoms move; bond-length conservation in bend holds only to first
// order in the displacement amplitude. This is still scripted teaching
// motion, not self-consistent molecular dynamics, but the COM-conservation
// constraint matches the defining property of internal vibrational normal
// modes.
//
// Equilibrium geometry with COM at origin, H atoms below O (textbook
// orientation) and bond length L₀, H-O-H angle θ₀:
//   r_O   = (0,                 +L₀·cos(θ₀/2)/9)
//   r_H±  = (±L₀·sin(θ₀/2), -(8/9)·L₀·cos(θ₀/2))
// where the 1/9 and 8/9 factors come from the mass ratio:
//   y_O · (m_O + 2·m_H) + 2·m_H·(-L₀·cos(θ₀/2)) = 0
//   y_O · 18           = 2·L₀·cos(θ₀/2)
//   y_O                = L₀·cos(θ₀/2) / 9.
//
// Masses use exact ratio 16:1 (¹⁶O / ¹H approximation). The tiny isotopic
// correction (real ratio ≈ 15.87) is pedagogically irrelevant and would only
// make tests noisier.
//
// Frequency choice: real H₂O symmetric stretch (~3657 cm⁻¹) is about 2.3×
// the bend frequency (~1595 cm⁻¹). We use 2.0× (stretch ω = 4.0,
// bend ω = 2.0) to keep the IR-spectroscopy intuition that vibrational
// modes have characteristic frequencies, while keeping the bend mode
// visually responsive in sandbox time.
//
// Peak speeds: maxHistorySpeed(mode) = A·ω · max_atom |δ_atom|. With H δ
// vectors normalized to unit length and O δ y-norms ≤ ~1/8, the H atoms
// bind, so
//   stretch: peak |dH/dt| = A_stretch·ω_stretch = 0.4
//   bend:    peak |dH/dt| = A_bend·ω_bend       = 0.18
// Both ≤ 0.5, so both share `CMIN_OSCILLATING`. M14 had bend's peak H speed
// at 0.18 via L₀·Δθ·ω/2; M15-A keeps that peak speed via a world-unit
// amplitude A_bend = 0.09 paired with a bend basis that is unit-length on H,
// so the visual cadence of bend does not change between M14 and M15-A.
export const WATER_M_O                  = 16;    // ¹⁶O / ¹H mass-ratio approximation
export const WATER_M_H                  = 1;
export const WATER_M_TOTAL              = WATER_M_O + 2 * WATER_M_H; // 18

export const WATER_O_CHARGE             = -0.8;
export const WATER_H_CHARGE             = +0.4;
export const WATER_BOND_LENGTH          = 0.6;                    // L₀, world units
export const WATER_HOH_ANGLE_RAD        = (105 * Math.PI) / 180;  // θ₀ ≈ 1.833 rad

// COM-centered equilibrium positions. m_H/(m_O+2·m_H) = 1/18, so
// y_O = (2/18)·L₀·cos(θ₀/2) = L₀·cos(θ₀/2)/9 and the H atoms sit at the
// remaining (8/9)·L₀·cos(θ₀/2) below the origin. These are the static
// positions about which the normal-mode displacements oscillate.
export const WATER_O_EQ_Y               = +WATER_BOND_LENGTH * Math.cos(WATER_HOH_ANGLE_RAD / 2) / 9;
export const WATER_H_EQ_X               = WATER_BOND_LENGTH * Math.sin(WATER_HOH_ANGLE_RAD / 2);
export const WATER_H_EQ_Y               = -(8 / 9) * WATER_BOND_LENGTH * Math.cos(WATER_HOH_ANGLE_RAD / 2);

// Stretch-mode COM-restoring scale for O. Both H atoms displace along their
// outward bond unit vector (±sinφ, -cosφ); the H y-components sum to -2·cosφ,
// so COM-restoration gives δ_O_y = -2·m_H/m_O · (-cosφ) = +cosφ/8. The
// general formula δ_O = -(m_H/m_O)·(δ_H+ + δ_H-) is mode-specific; bend has
// a different scale (see WATER_BEND_NORM below). This constant is reserved
// for the stretch derivation.
export const WATER_STRETCH_O_COM_SCALE  = 2 * WATER_M_H / WATER_M_O; // 1/8

// Bend-mode normalization constant. The first-order bend normal mode in
// internal coordinates is
//   δ_H+ ∝ (cosφ, (8/9)·sinφ),  δ_H- ∝ (-cosφ, (8/9)·sinφ),
//   δ_O  ∝ (0,    -sinφ/9)
// (derived by linearizing the COM-centered equilibrium with respect to the
// half-angle φ at fixed bond length L₀). Bond length is preserved to first
// order because the relative O-H displacement is tangent to the equilibrium
// bond direction: u · (δ_H+ - δ_O) = sinφ·cosφ + (-cosφ)·sinφ = 0.
//
// The unnormalized basis has |δ_H+|² = cos²φ + (64/81)·sin²φ. We divide by
// the square root of that quantity so |δ_H+| = 1 and maxHistorySpeed reduces
// to A_bend·ω_bend per the contract. WATER_BEND_NORM = √(cos²φ + (64/81)·sin²φ).
export const WATER_BEND_NORM            = Math.sqrt(
  Math.cos(WATER_HOH_ANGLE_RAD / 2) ** 2 +
  (64 / 81) * Math.sin(WATER_HOH_ANGLE_RAD / 2) ** 2,
);

export const WATER_STRETCH_AMPLITUDE    = 0.1;   // A, world-unit displacement along bond
export const WATER_STRETCH_OMEGA        = 4.0;   // rad/s; T_stretch ≈ π/2 ≈ 1.57 s

// Bend amplitude is a world-unit displacement amplitude scaling the
// normalized COM-linearized bend basis (M15-A). The basis is normalized so
// |δ_H| = 1, and first-order O–H bond-length preservation lives in the
// relative coordinate δ_H - δ_O (not in the absolute H displacement
// direction). The previous M14 constant `WATER_BEND_AMPLITUDE_RAD = 0.3`
// was an angular amplitude paired with an L₀-radius arc giving peak
// tangential H displacement ≈ L₀·0.15 = 0.09. Setting A_bend = 0.09
// preserves the M14 peak H speed of 0.18 (= A_bend·ω_bend).
export const WATER_BEND_AMPLITUDE       = 0.09;  // A, world-unit amplitude for the normalized bend basis
export const WATER_BEND_OMEGA           = 2.0;   // rad/s; T_bend ≈ π ≈ 3.14 s

// Back-compat alias retained for external readers that previously consumed
// the M14 angular amplitude. The first-order relationship A_bend ≈ L₀·Δφ
// (where Δφ is the half-angle swing) lets callers convert. For the M14 visual
// safety check that asserts θ(t) stays in (0, π) we now express the half-angle
// window via the world-unit amplitude: |Δφ_peak| = A_bend/L₀.
export const WATER_BEND_AMPLITUDE_RAD   = (2 * WATER_BEND_AMPLITUDE) / WATER_BOND_LENGTH; // = 0.3, matches M14

// Antisymmetric stretch (M15-B). Bond 1 stretches outward along its bond
// unit vector while bond 2 compresses along its bond unit vector (in
// magnitude). The COM-restoring O displacement is along -x̂, giving a
// time-varying dipole along x̂ (perpendicular to the C₂ axis, distinguishing
// asym from sym/bend which dipole along ŷ).
//
// ω chosen close to ω_stretch but distinct (4.2 vs 4.0) so students see the
// IR-spectroscopy lesson that ν₁ and ν₃ are nearby but not identical (real
// H₂O: ν₃/ν₁ ≈ 3756/3657 ≈ 1.027; sandbox: 4.2/4.0 = 1.05).
//
// H δ vectors are unit length without normalization: δ_H+ = (sin(θ₀/2), -cos(θ₀/2)),
// δ_H- = (sin(θ₀/2), +cos(θ₀/2)). So peak H speed = A·ω = 0.1·4.2 = 0.42, ≤ 0.5.
export const WATER_ASYM_STRETCH_AMPLITUDE = 0.1;   // A, world-unit displacement along bond
export const WATER_ASYM_STRETCH_OMEGA     = 4.2;   // rad/s; T ≈ 1.50 s

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
export function sampleSourceState(mode: SingleChargeDemoMode, t: number): KinematicState {
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
 * Exact kinematic state for the water symmetric-stretch mode (M15-A).
 *
 * Charge index ordering: 0 = O, 1 = H₊x, 2 = H₋x. All three atoms move;
 * the mass-weighted COM stays at the world origin at all t by construction.
 *
 * Normal-mode displacement basis around the COM-centered equilibrium:
 *   δ_H+ = (+sin(θ₀/2), -cos(θ₀/2))         [unit vector along H+ bond, outward]
 *   δ_H- = (-sin(θ₀/2), -cos(θ₀/2))         [unit vector along H- bond, outward]
 *   δ_O  = (0, +cos(θ₀/2)/8)                [COM-restoring counter-displacement]
 * The O coefficient 1/8 = 2·m_H/m_O · cos(θ₀/2) / cos(θ₀/2) — it follows from
 * m_O·δ_O_y + 2·m_H·(-cos(θ₀/2)) = 0 with m_O = 16, m_H = 1.
 *
 * Position: r_atom(t) = r_atom_eq + A·sin(ω·t)·δ_atom
 * Velocity: A·ω·cos(ω·t)·δ_atom
 * Accel:   -A·ω²·sin(ω·t)·δ_atom
 *
 * Peak H speed = A·ω·|δ_H| = A·ω = 0.4 (H δ is unit length, so H binds the
 * maxHistorySpeed budget). Time-varying dipole oscillates along ŷ.
 */
function sampleWaterStretchState(chargeIndex: 0 | 1 | 2, t: number): KinematicState {
  const halfAngle = WATER_HOH_ANGLE_RAD / 2;
  const sinHalf   = Math.sin(halfAngle);
  const cosHalf   = Math.cos(halfAngle);

  const A = WATER_STRETCH_AMPLITUDE;
  const w = WATER_STRETCH_OMEGA;
  const s   =  Math.sin(w * t);
  const sp  =  w * Math.cos(w * t);
  const spp = -w * w * Math.sin(w * t);

  if (chargeIndex === 0) {
    // O: δ_O = (0, +cos(θ/2)/8); equilibrium at (0, +cos(θ/2)·L₀/9).
    const dy = +cosHalf * WATER_STRETCH_O_COM_SCALE;
    return {
      t,
      pos:   { x: 0, y: WATER_O_EQ_Y + A * s   * dy },
      vel:   { x: 0, y:               A * sp  * dy },
      accel: { x: 0, y:               A * spp * dy },
    };
  }

  // H atoms: δ_H+ = (+sin(θ/2), -cos(θ/2)), δ_H- = (-sin(θ/2), -cos(θ/2));
  // equilibrium at (±L₀·sin(θ/2), -(8/9)·L₀·cos(θ/2)).
  const sign = chargeIndex === 1 ? +1 : -1;
  const dx   = sign * sinHalf;
  const dy   = -cosHalf;
  return {
    t,
    pos:   { x: sign * WATER_H_EQ_X + A * s   * dx, y: WATER_H_EQ_Y + A * s   * dy },
    vel:   { x:                       A * sp  * dx, y:                A * sp  * dy },
    accel: { x:                       A * spp * dx, y:                A * spp * dy },
  };
}

/**
 * Exact kinematic state for the water bend (scissoring) mode (M15-A).
 *
 * Charge index ordering: 0 = O, 1 = H₊x, 2 = H₋x. All three atoms move;
 * the mass-weighted COM stays at the world origin at all t by construction.
 *
 * Normal-mode displacement basis around the COM-centered equilibrium,
 * derived by linearizing the COM-centered equilibrium positions with
 * respect to the half-angle φ at fixed bond length L₀. Unnormalized
 * (proportional to dφ):
 *   δ_H+ ∝ (+cos(θ₀/2), +(8/9)·sin(θ₀/2))
 *   δ_H- ∝ (-cos(θ₀/2), +(8/9)·sin(θ₀/2))
 *   δ_O  ∝ (0,          -sin(θ₀/2)/9)
 *
 * Two key properties hold by construction:
 *
 *   1. Mass-weighted COM is conserved:
 *      m_O·(-sin(θ₀/2)/9) + m_H·(2·(8/9)·sin(θ₀/2)) = 0
 *      (= -16·sin(θ₀/2)/9 + 16·sin(θ₀/2)/9 = 0 with m_O=16, m_H=1).
 *
 *   2. Bond length is preserved to first order in A. The equilibrium bond
 *      unit vector u = (sin(θ₀/2), -cos(θ₀/2)). The relative O–H
 *      displacement is
 *         δ_H+ - δ_O ∝ (cos(θ₀/2), (8/9 + 1/9)·sin(θ₀/2)) = (cos(θ₀/2), sin(θ₀/2))
 *      so u · (δ_H+ - δ_O) = sin(θ₀/2)·cos(θ₀/2) + (-cos(θ₀/2))·sin(θ₀/2) = 0.
 *      At finite A the bond length still varies by O(A²/L₀); this is a
 *      small-displacement normal-mode model, not exact rigid-bond rotation.
 *
 * The basis is normalized so |δ_H| = 1, i.e. divided by
 * WATER_BEND_NORM = √(cos²(θ₀/2) + (64/81)·sin²(θ₀/2)), so the peak H speed
 * reduces to A_bend·ω_bend = 0.18 (matching M14) under the
 * maxHistorySpeed(mode) = A·ω · max_atom |δ_atom| contract.
 *
 * Positive-amplitude phase corresponds to the H–O–H angle opening (H atoms
 * move away from the C₂ axis, O moves down to compensate). Time-varying
 * dipole oscillates along ŷ, same orientation as symmetric stretch.
 */
function sampleWaterBendState(chargeIndex: 0 | 1 | 2, t: number): KinematicState {
  const halfAngle = WATER_HOH_ANGLE_RAD / 2;
  const sinHalf   = Math.sin(halfAngle);
  const cosHalf   = Math.cos(halfAngle);
  const N         = WATER_BEND_NORM;

  const A = WATER_BEND_AMPLITUDE;
  const w = WATER_BEND_OMEGA;
  const s   =  Math.sin(w * t);
  const sp  =  w * Math.cos(w * t);
  const spp = -w * w * Math.sin(w * t);

  if (chargeIndex === 0) {
    // O: δ_O = (0, -sin(θ/2)/(9·N)); equilibrium at (0, +cos(θ/2)·L₀/9).
    const dy = -sinHalf / (9 * N);
    return {
      t,
      pos:   { x: 0, y: WATER_O_EQ_Y + A * s   * dy },
      vel:   { x: 0, y:               A * sp  * dy },
      accel: { x: 0, y:               A * spp * dy },
    };
  }

  // H atoms: δ_H+ = ((cos(θ/2))/N, (8/9)·sin(θ/2)/N),
  //          δ_H- = (-(cos(θ/2))/N, (8/9)·sin(θ/2)/N);
  // equilibrium at (±L₀·sin(θ/2), -(8/9)·L₀·cos(θ/2)).
  const sign = chargeIndex === 1 ? +1 : -1;
  const dx   = sign * cosHalf / N;
  const dy   = (8 / 9) * sinHalf / N;
  return {
    t,
    pos:   { x: sign * WATER_H_EQ_X + A * s   * dx, y: WATER_H_EQ_Y + A * s   * dy },
    vel:   { x:                       A * sp  * dx, y:                A * sp  * dy },
    accel: { x:                       A * spp * dx, y:                A * spp * dy },
  };
}

/**
 * Exact kinematic state for the water antisymmetric-stretch mode (M15-B, ν₃).
 *
 * Charge index ordering: 0 = O, 1 = H₊x, 2 = H₋x. All three atoms move;
 * the mass-weighted COM stays at the world origin at all t by construction.
 *
 * Normal-mode displacement basis around the COM-centered equilibrium.
 * Each H displaces along its outward bond unit vector with opposite-sign
 * scalar amplitudes: H+ moves outward (bond 1 stretches) while H- moves
 * inward (bond 2 compresses), or vice versa. O takes the COM-restoring
 * counter-displacement along -x̂.
 *   δ_H+ = (+sin(θ₀/2), -cos(θ₀/2))   [unit length, along H+ outward bond]
 *   δ_H- = (+sin(θ₀/2), +cos(θ₀/2))   [unit length, along H- inward bond — compressing]
 *   δ_O  = (-sin(θ₀/2)/8, 0)           [COM-restoring counter-displacement along -x̂]
 *
 * Three key properties hold by construction:
 *
 *   1. Mass-weighted COM is conserved:
 *      m_O·(-sin(θ₀/2)/8) + m_H·(2·sin(θ₀/2)) = -2·sin(θ₀/2) + 2·sin(θ₀/2) = 0.
 *
 *   2. Antisymmetric bond-length change to first order in A:
 *      |b_1| - L₀ ≈ +A·sin(ω·t)·(1 + sin²(θ₀/2)/8)
 *      |b_2| - L₀ ≈ -A·sin(ω·t)·(1 + sin²(θ₀/2)/8)
 *      The symmetric combination (r_1 + r_2) is conserved to first order; only
 *      the antisymmetric combination (r_1 - r_2) is excited. At finite A the
 *      O(A²) corrections to each bond length need not be exactly equal in
 *      magnitude, but they are quadratic and small.
 *
 *   3. Interior H-O-H angle preserved to first order: both bond directions
 *      pick up the same first-order CCW rotation of magnitude
 *      ≈ A·sin(θ₀/2)·cos(θ₀/2)/(8·L₀), so the angle between them is
 *      unchanged. The whole molecule appears to rotate slightly in the body
 *      frame (≈ 0.6° peak at A=0.1) — a consequence of imposing translational
 *      COM conservation without simultaneously imposing angular-momentum
 *      conservation. This is acceptable for the scripted teaching motion and
 *      visually negligible. (Eckart conditions would null it in real physics.)
 *
 * Position: r_atom(t) = r_atom_eq + A·sin(ω·t)·δ_atom
 * Velocity: A·ω·cos(ω·t)·δ_atom
 * Accel:   -A·ω²·sin(ω·t)·δ_atom
 *
 * Peak H speed = A·ω·|δ_H| = A·ω = 0.42 (H δ is unit length, so H binds the
 * maxHistorySpeed budget). Time-varying dipole oscillates along x̂,
 * distinguishing asym from sym/bend (which dipole along ŷ).
 */
function sampleWaterAsymStretchState(chargeIndex: 0 | 1 | 2, t: number): KinematicState {
  const halfAngle = WATER_HOH_ANGLE_RAD / 2;
  const sinHalf   = Math.sin(halfAngle);
  const cosHalf   = Math.cos(halfAngle);

  const A = WATER_ASYM_STRETCH_AMPLITUDE;
  const w = WATER_ASYM_STRETCH_OMEGA;
  const s   =  Math.sin(w * t);
  const sp  =  w * Math.cos(w * t);
  const spp = -w * w * Math.sin(w * t);

  if (chargeIndex === 0) {
    // O: δ_O = (-sin(θ/2)/8, 0); equilibrium at (0, +cos(θ/2)·L₀/9).
    const dx = -sinHalf / 8;
    return {
      t,
      pos:   { x: A * s   * dx, y: WATER_O_EQ_Y },
      vel:   { x: A * sp  * dx, y: 0           },
      accel: { x: A * spp * dx, y: 0           },
    };
  }

  // H atoms: δ_H+ = (sin(θ/2), -cos(θ/2)),   δ_H- = (sin(θ/2), +cos(θ/2));
  // equilibrium at (±L₀·sin(θ/2), -(8/9)·L₀·cos(θ/2)).
  // dx is the same for both H atoms (positive); dy flips sign with chargeIndex.
  const sign = chargeIndex === 1 ? +1 : -1;
  const dx   = +sinHalf;
  const dy   = -sign * cosHalf;
  return {
    t,
    pos:   { x: sign * WATER_H_EQ_X + A * s   * dx, y: WATER_H_EQ_Y + A * s   * dy },
    vel:   { x:                       A * sp  * dx, y:                A * sp  * dy },
    accel: { x:                       A * spp * dx, y:                A * spp * dy },
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
  if (mode === 'water_asym_stretch') {
    return [
      { charge: WATER_O_CHARGE, state: sampleWaterAsymStretchState(0, t) },
      { charge: WATER_H_CHARGE, state: sampleWaterAsymStretchState(1, t) },
      { charge: WATER_H_CHARGE, state: sampleWaterAsymStretchState(2, t) },
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
  // Water modes (M15): peak speed = A·ω · max_atom |δ_atom|. H δ vectors are
  // unit length and O δ norms ≤ 1/8, so H always binds and the value reduces
  // to A·ω per mode.
  //   stretch:      0.4   (A_stretch = 0.10, ω_stretch = 4.0)
  //   bend:         0.18  (A_bend    = 0.09, ω_bend    = 2.0; matches the M14 peak)
  //   asym_stretch: 0.42  (A_asym    = 0.10, ω_asym    = 4.2; M15-B)
  if (mode === 'water_stretch')      return WATER_STRETCH_AMPLITUDE      * WATER_STRETCH_OMEGA;       // 0.4
  if (mode === 'water_bend')         return WATER_BEND_AMPLITUDE         * WATER_BEND_OMEGA;          // 0.18
  if (mode === 'water_asym_stretch') return WATER_ASYM_STRETCH_AMPLITUDE * WATER_ASYM_STRETCH_OMEGA;  // 0.42
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

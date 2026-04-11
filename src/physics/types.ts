// Core physics types for the charge-radiation-sandbox.
// All physics uses Cartesian world coordinates (+X right, +Y up).
// Canvas/screen coordinate conversion happens in the rendering layer only.

/** A 2D vector in world space. */
export type Vec2 = { x: number; y: number };

/**
 * The complete kinematic state of a charge at a single instant in time.
 * This is what the history buffer stores and what the retarded-time solver returns.
 */
export type KinematicState = {
  t: number;     // simulation time (s, or simulation time units)
  pos: Vec2;     // position (world units)
  vel: Vec2;     // velocity (world units / s)
  accel: Vec2;   // acceleration (world units / s²)
};

/**
 * Configuration for the simulation.
 * c must always flow as a parameter — never hardcode the speed of light.
 */
export type SimConfig = {
  /** Speed of light in simulation units. Default simulation value: 1.0. */
  c: number;
  /**
   * Plummer softening radius ε (world units). Prevents 1/R divergence near charges.
   * R_eff = sqrt(R² + ε²). Default: 0.01.
   */
  softening?: number;
};

/**
 * Result from the retarded-time solver (retardedTime.ts).
 *
 * A null return from solveRetardedState (not this type) signals empty history —
 * that is a normal operational state, not an error.
 */
export type RetardedSolveResult = {
  /** The retarded time t_ret such that t_obs - |r_obs - r(t_ret)| / c ≈ 0. */
  tRet: number;
  /** The interpolated charge state at t_ret. */
  state: KinematicState;
  /**
   * True if the iteration converged within tolerance before hitting maxIterations.
   * False means the best available iterate is returned — still usable, just less precise.
   */
  converged: boolean;
  /** Number of fixed-point iterations performed. */
  iterations: number;
  /**
   * True if the needed t_ret predated the oldest entry in the history buffer.
   * The solver clamped to the oldest available state. Fields computed from a clamped
   * state are physically approximate; the charge's past is not fully recorded.
   */
  usedClampFallback: boolean;
};

/**
 * Result from the Liénard-Wiechert field evaluator (lienardWiechert.ts).
 *
 * A null return from evaluateLienardWiechertField signals empty history (propagated
 * from the solver). Null is a normal operational state on the first frame.
 *
 * Field decomposition:
 *   eVel   — velocity (Coulomb-like) field, decays as 1/R². Always present.
 *   eAccel — acceleration (radiation) field, decays as 1/R. Nonzero only during acceleration.
 *   eTotal — superposition: eVel + eAccel.
 *   bZ     — total out-of-plane magnetic field (scalar z-component).
 *            Identity: bZ = bZVel + bZAccel = cross2D(nHat, eTotal) / c.
 *   bZVel  — magnetic field from the velocity term: cross2D(nHat, eVel) / c.
 *            Nonzero for a moving charge even with no acceleration.
 *   bZAccel — magnetic field from the acceleration (radiation) term: cross2D(nHat, eAccel) / c.
 *            Identically zero for a stationary or uniformly moving charge. Nonzero only
 *            during acceleration. This is the radiative magnetic component.
 */
export type LWFieldResult = {
  eVel: Vec2;    // velocity field (1/R² decay)
  eAccel: Vec2;  // acceleration/radiation field (1/R decay)
  eTotal: Vec2;  // eVel + eAccel
  bZ: number;    // total out-of-plane B field scalar: cross2D(nHat, eTotal) / c
  bZVel: number;   // magnetic velocity term: cross2D(nHat, eVel) / c
  bZAccel: number; // magnetic radiation term: cross2D(nHat, eAccel) / c
};

/**
 * Axis-aligned bounds for physics-layer consumers (e.g. the wavefront sampler).
 * Identical shape to WorldBounds in the rendering layer but defined here to keep
 * physics free of rendering imports.
 */
export type SamplerBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

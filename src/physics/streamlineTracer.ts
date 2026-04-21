// Streamline tracer for paused-frame LW field visualization.
//
// Traces the instantaneous electric field-lines of the LW field at a fixed
// simulation snapshot. Intended for use ONLY on paused or stepped frames — not
// during continuous playback, which would require retracing every frame at
// O(seeds × steps × LW-solves) cost.
//
// The resulting curves represent the electric field direction at a specific
// instant in simulation time. They are NOT material lines that physically move
// with the charge; they are a snapshot visualization tool. In a time-dependent
// LW field, streamlines at different instants look different.
//
// Algorithm: 4th-order Runge-Kutta integration along the normalized E-field
// direction, seeded radially around the charge position.

import { evaluateLienardWiechertField, evaluateSuperposedLienardWiechertField } from './lienardWiechert';
import { ChargeHistory } from './chargeHistory';
import type { ChargeRuntime } from './chargeRuntime';
import type { SimConfig, Vec2 } from './types';
import { magnitude } from './vec2';

export type StreamlineOptions = {
  /** World-space arc-length step per RK4 integration step. */
  stepSize: number;
  /** Maximum RK4 steps per seed line. */
  maxSteps: number;
  /** Field-magnitude cutoff: tracing stops when |E| falls below this. */
  minFieldMagnitude: number;
  /** Radius at which seeds are placed around the charge position. */
  seedOffsetRadius: number;
  /** Number of evenly-spaced seeds placed radially around the charge. */
  seedCount: number;
};

export const DEFAULT_STREAMLINE_OPTIONS: StreamlineOptions = {
  stepSize: 0.035,
  maxSteps: 350,
  minFieldMagnitude: 0.002,
  seedOffsetRadius: 0.12,
  seedCount: 16,
};

// Ghost-line alignment heuristics for the sudden-stop demo.
//
// The radiation shell has finite thickness because the stop happens over
// SUDDEN_STOP_T_BRAKE, not instantaneously. Matching ghost lines to the ideal
// zero-thickness shell crossing anchors them too early, while the real
// streamline is still turning through the acceleration band.
//
// Instead, find the first point on each real streamline where the acceleration
// contribution has risen through the band and then fallen back to a small
// fraction of the total field. That point lies on the settled outer branch,
// where the old velocity field dominates again.
const GHOST_ACCEL_ENTER_RATIO = 0.12;
const GHOST_ACCEL_EXIT_RATIO = 0.05;
const GHOST_EXIT_RUN_LENGTH = 3;
const GHOST_EXIT_FORWARD_OFFSET = 2;

type TraceBounds = { minX: number; maxX: number; minY: number; maxY: number };

function inBounds(pt: Vec2, b: TraceBounds): boolean {
  return pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY;
}

/**
 * Evaluate the normalized E-field direction at a world-space point.
 *
 * @param velocityOnly - If true, use only the velocity (Coulomb-like) term of E.
 *   Pass true for ghost-charge streamlines: the ghost represents constant-velocity
 *   extrapolated motion with no radiation term.
 * Returns null when: history is empty, field falls below minFieldMagnitude, or
 * the retarded-time solver returns null.
 */
function evalNormalizedField(
  pos: Vec2,
  observationTime: number,
  chargeRuntimes: ChargeRuntime[],
  config: SimConfig,
  velocityOnly: boolean,
  minFieldMagnitude: number,
): Vec2 | null {
  const result = evaluateSuperposedLienardWiechertField({
    observationPos: pos,
    observationTime,
    chargeRuntimes,
    config,
  });
  if (!result) return null;

  const field = velocityOnly ? result.eVel : result.eTotal;
  const mag = magnitude(field);
  if (mag < minFieldMagnitude) return null;
  return { x: field.x / mag, y: field.y / mag };
}

/**
 * One RK4 step along the field-line.
 * Returns the next world-space point, or null if the field is too weak at any
 * substep (which terminates tracing gracefully).
 *
 * directionSign: +1 follows the field (outward from positive charge),
 *               −1 traces backward (outward from negative charge).
 */
function rk4Step(
  pos: Vec2,
  observationTime: number,
  chargeRuntimes: ChargeRuntime[],
  config: SimConfig,
  velocityOnly: boolean,
  stepSize: number,
  directionSign: number,
  minFieldMagnitude: number,
): Vec2 | null {
  const eval_ = (p: Vec2) =>
    evalNormalizedField(p, observationTime, chargeRuntimes, config, velocityOnly, minFieldMagnitude);

  const k1 = eval_(pos);
  if (!k1) return null;

  const p2: Vec2 = { x: pos.x + k1.x * stepSize * 0.5 * directionSign, y: pos.y + k1.y * stepSize * 0.5 * directionSign };
  const k2 = eval_(p2);
  if (!k2) return null;

  const p3: Vec2 = { x: pos.x + k2.x * stepSize * 0.5 * directionSign, y: pos.y + k2.y * stepSize * 0.5 * directionSign };
  const k3 = eval_(p3);
  if (!k3) return null;

  const p4: Vec2 = { x: pos.x + k3.x * stepSize * directionSign, y: pos.y + k3.y * stepSize * directionSign };
  const k4 = eval_(p4);
  if (!k4) return null;

  // Weighted RK4 average direction, then re-normalize before stepping.
  const avx = (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6;
  const avy = (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6;
  const avMag = Math.sqrt(avx * avx + avy * avy);
  if (avMag < 1e-12) return null;

  return {
    x: pos.x + (avx / avMag) * stepSize * directionSign,
    y: pos.y + (avy / avMag) * stepSize * directionSign,
  };
}

/**
 * Trace a single field-line from `seed` in direction `directionSign`.
 * Only records points while inside `bounds` (clip region); stops permanently
 * once the line exits the bounds after entering.
 */
function traceSingleLine(
  seed: Vec2,
  observationTime: number,
  chargeRuntimes: ChargeRuntime[],
  config: SimConfig,
  bounds: TraceBounds,
  directionSign: number,
  opts: StreamlineOptions,
  velocityOnly: boolean,
): Vec2[] {
  const points: Vec2[] = [];
  let current: Vec2 = { x: seed.x, y: seed.y };
  let hasEnteredBounds = false;

  for (let i = 0; i < opts.maxSteps; i++) {
    const inside = inBounds(current, bounds);
    if (!inside && hasEnteredBounds) break;

    if (inside) {
      hasEnteredBounds = true;
      points.push({ x: current.x, y: current.y });
    }

    const next = rk4Step(
      current, observationTime, chargeRuntimes, config,
      velocityOnly, opts.stepSize, directionSign, opts.minFieldMagnitude,
    );
    if (!next) break;
    current = next;
  }

  return points;
}

/**
 * Trace a full set of streamlines for the LW field at a paused frame.
 *
 * Seeds are placed radially around `chargePos` at `opts.seedOffsetRadius`.
 * Positive charge → lines trace outward (+1 direction); negative charge → −1.
 *
 * The tracing bounds are padded 2× beyond `bounds` so the traced polylines
 * extend well past the current viewport. Rendering clips naturally at the
 * canvas edge, so the same lines remain valid across moderate pan/zoom changes
 * without retracing.
 *
 * @param chargePos      World-space position to seed from (newest history entry pos).
 * @param observationTime Simulation time of the paused frame.
 * @param history        The charge's history buffer.
 * @param charge         Signed charge value (sign determines direction).
 * @param config         Simulation config (c, softening).
 * @param bounds         World-space view bounds (used to define padded clip region).
 * @param opts             Optional overrides for trace parameters.
 * @param velocityOnly     Trace only the velocity (Coulomb-like) E-field component.
 *                         Pass true for ghost-charge streamlines.
 * @param customSeedAngles If provided, override the uniform angular seed placement
 *                         with these specific angles (radians). Length need not match
 *                         seedCount — all entries are used. Useful for geometric
 *                         seed-matching between real and ghost field lines so that
 *                         corresponding flux tubes align across the radiation shell.
 */
export function buildStreamlines(
  chargePos: Vec2,
  observationTime: number,
  chargeRuntimes: ChargeRuntime[],
  config: SimConfig,
  bounds: TraceBounds,
  opts?: Partial<StreamlineOptions>,
  velocityOnly = false,
  customSeedAngles?: number[],
  /** Direction sign for tracing: +1 = outward (positive charge), −1 = inward (negative charge).
   *  Defaults to the sign of chargeRuntimes[0].charge. */
  directionSign?: number,
): Vec2[][] {
  const options: StreamlineOptions = { ...DEFAULT_STREAMLINE_OPTIONS, ...opts };

  // Pad the clip bounds 2× so traced lines extend well beyond the viewport.
  // This amortizes tracing cost across pan/zoom changes without retracing.
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const paddedBounds: TraceBounds = {
    minX: bounds.minX - spanX * 2,
    maxX: bounds.maxX + spanX * 2,
    minY: bounds.minY - spanY * 2,
    maxY: bounds.maxY + spanY * 2,
  };

  const lines: Vec2[][] = [];
  // Default direction: outward from positive charge, inward toward negative charge.
  const dirSign = directionSign ?? ((chargeRuntimes[0]?.charge ?? 1) >= 0 ? 1 : -1);

  const seedAngles: number[] = customSeedAngles
    ?? Array.from({ length: options.seedCount }, (_, i) => (i / options.seedCount) * Math.PI * 2);

  for (const angle of seedAngles) {
    const seed: Vec2 = {
      x: chargePos.x + options.seedOffsetRadius * Math.cos(angle),
      y: chargePos.y + options.seedOffsetRadius * Math.sin(angle),
    };
    const line = traceSingleLine(
      seed, observationTime, chargeRuntimes, config,
      paddedBounds, dirSign, options, velocityOnly,
    );
    if (line.length >= 4) {
      lines.push(line);
    }
  }

  return lines;
}

function analyticGhostSeedAngle(realSeedAngle: number, ghostVel: Vec2, c: number): number {
  return Math.atan2(
    c * Math.sin(realSeedAngle) - ghostVel.y,
    c * Math.cos(realSeedAngle) - ghostVel.x,
  );
}

function findGhostAnchorOnRealLine(
  line: Vec2[],
  observationTime: number,
  history: ChargeHistory,
  charge: number,
  config: SimConfig,
): Vec2 | null {
  let sawAccelerationBand = false;
  let settledRun = 0;

  for (let i = 0; i < line.length; i++) {
    const result = evaluateLienardWiechertField({
      observationPos: line[i],
      observationTime,
      history,
      charge,
      config,
    });
    if (!result) continue;

    const totalMag = magnitude(result.eTotal);
    if (totalMag < 1e-8) continue;

    const accelRatio = magnitude(result.eAccel) / totalMag;
    if (!sawAccelerationBand) {
      if (accelRatio >= GHOST_ACCEL_ENTER_RATIO) {
        sawAccelerationBand = true;
      }
      continue;
    }

    if (accelRatio <= GHOST_ACCEL_EXIT_RATIO) {
      settledRun += 1;
    } else {
      settledRun = 0;
    }

    if (settledRun >= GHOST_EXIT_RUN_LENGTH) {
      const anchorIndex = Math.min(i + GHOST_EXIT_FORWARD_OFFSET, line.length - 1);
      return line[anchorIndex];
    }
  }

  return null;
}

// ── Ghost seed-angle numeric solve ───────────────────────────────────────────
//
// For strongly anisotropic velocity fields (low c, high β) the ray from the
// ghost charge to the anchor is only an approximation of the seed angle whose
// streamline actually passes through that anchor. The solve replaces the direct
// atan2 with a cheap coarse-then-refine search over a ±0.35 rad window.

const GHOST_SEED_SEARCH_HALF   = 0.35;  // half-width of search window (rad)
const GHOST_SEED_COARSE_N      = 9;     // samples in coarse sweep
const GHOST_SEED_REFINE_N      = 7;     // samples per refinement round
const GHOST_SEED_REFINE_ROUNDS = 3;     // number of narrowing rounds
const GHOST_SEED_MAX_STEPS     = 150;   // reduced step budget for search traces

/** Squared distance from `point` to the nearest point on any segment of `polyline`. */
function minDistSquaredToPolyline(point: Vec2, polyline: Vec2[]): number {
  let minD2 = Infinity;
  for (let i = 0; i + 1 < polyline.length; i++) {
    const ax = polyline[i].x,     ay = polyline[i].y;
    const bx = polyline[i + 1].x, by = polyline[i + 1].y;
    const dx = bx - ax,           dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-20) {
      t = ((point.x - ax) * dx + (point.y - ay) * dy) / lenSq;
      if (t < 0) t = 0; else if (t > 1) t = 1;
    }
    const ex = ax + t * dx - point.x;
    const ey = ay + t * dy - point.y;
    const d2 = ex * ex + ey * ey;
    if (d2 < minD2) minD2 = d2;
  }
  return minD2;
}

/**
 * Find the ghost seed angle whose streamline passes closest to `anchor`.
 *
 * Two-stage search in [theta0 ± GHOST_SEED_SEARCH_HALF]:
 *   1. Coarse: GHOST_SEED_COARSE_N evenly-spaced samples → best theta.
 *   2. Refine: GHOST_SEED_REFINE_ROUNDS rounds, each sampling GHOST_SEED_REFINE_N
 *      points in the ±spacing/2 neighbourhood of the current best.
 *
 * Each candidate is evaluated by tracing a full ghost streamline (capped at
 * GHOST_SEED_MAX_STEPS) and computing the minimum squared distance to `anchor`.
 *
 * Falls back to `theta0` implicitly when all search traces are empty (the
 * initial bestTheta is theta0 and bestDist2 starts at Infinity).
 */
function solveGhostSeedAngle(
  anchor: Vec2,
  ghostPos: Vec2,
  observationTime: number,
  ghostHistory: ChargeHistory,
  charge: number,
  config: SimConfig,
  bounds: TraceBounds,
  opts: StreamlineOptions,
  theta0: number,
): number {
  // Padded clip region — same 2× expansion used by buildStreamlines.
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const paddedBounds: TraceBounds = {
    minX: bounds.minX - spanX * 2, maxX: bounds.maxX + spanX * 2,
    minY: bounds.minY - spanY * 2, maxY: bounds.maxY + spanY * 2,
  };
  const searchOpts: StreamlineOptions = { ...opts, maxSteps: GHOST_SEED_MAX_STEPS };
  const dirSign = charge >= 0 ? 1 : -1;

  const ghostRuntime: ChargeRuntime[] = [{ history: ghostHistory, charge }];
  const traceAndMeasure = (theta: number): number => {
    const seed: Vec2 = {
      x: ghostPos.x + opts.seedOffsetRadius * Math.cos(theta),
      y: ghostPos.y + opts.seedOffsetRadius * Math.sin(theta),
    };
    const line = traceSingleLine(
      seed, observationTime, ghostRuntime, config,
      paddedBounds, dirSign, searchOpts, true,
    );
    return line.length >= 2 ? minDistSquaredToPolyline(anchor, line) : Infinity;
  };

  const lo = theta0 - GHOST_SEED_SEARCH_HALF;
  const hi = theta0 + GHOST_SEED_SEARCH_HALF;
  let bestTheta = theta0;
  let bestDist2 = Infinity;

  // Coarse sweep — theta0 is included as the centre sample (COARSE_N is odd).
  for (let i = 0; i < GHOST_SEED_COARSE_N; i++) {
    const theta = lo + (i / (GHOST_SEED_COARSE_N - 1)) * (hi - lo);
    const d2 = traceAndMeasure(theta);
    if (d2 < bestDist2) { bestDist2 = d2; bestTheta = theta; }
  }

  // Refinement: progressively narrow the interval around the current best.
  // halfWidth starts at one coarse sample spacing; shrinks by (REFINE_N-1)/2 each round.
  let halfWidth = (hi - lo) / (GHOST_SEED_COARSE_N - 1);
  for (let round = 0; round < GHOST_SEED_REFINE_ROUNDS; round++) {
    const rLo = bestTheta - halfWidth;
    const rHi = bestTheta + halfWidth;
    for (let i = 0; i < GHOST_SEED_REFINE_N; i++) {
      const theta = rLo + (i / (GHOST_SEED_REFINE_N - 1)) * (rHi - rLo);
      const d2 = traceAndMeasure(theta);
      if (d2 < bestDist2) { bestDist2 = d2; bestTheta = theta; }
    }
    // New halfWidth = half of one refine-sample spacing = halfWidth / (REFINE_N - 1).
    halfWidth = halfWidth / (GHOST_SEED_REFINE_N - 1);
  }

  return bestTheta;
}

/**
 * Derive ghost-charge seed angles from the already-traced real streamlines.
 *
 * For each real streamline, find the first point after the radiation band where
 * the acceleration field has dropped back to a small fraction of the total
 * field. That anchor is the target the ghost streamline must pass through.
 *
 * The ghost seed angle is found by a two-stage numeric search (see
 * solveGhostSeedAngle) rather than the direct atan2 ray. The ray is only an
 * approximation for anisotropic velocity fields (low c / high β); the solve
 * finds the seed whose ghost streamline actually reaches the anchor.
 *
 * If no settled anchor is found for a line, fall back to the analytic
 * aberration formula derived from the real seed direction.
 *
 * @param ghostHistory  Pre-built ghost-charge history (from buildGhostHistory).
 * @param bounds        Unpadded view bounds (solve traces use the same 2× padding
 *                      as buildStreamlines).
 * @param opts          Optional streamline option overrides (usually undefined).
 */
export function deriveGhostSeedAnglesFromRealLines(
  realLines: Vec2[][],
  sourcePos: Vec2,
  ghostPos: Vec2,
  ghostVel: Vec2,
  observationTime: number,
  history: ChargeHistory,
  charge: number,
  config: SimConfig,
  ghostHistory: ChargeHistory,
  bounds: TraceBounds,
  opts?: Partial<StreamlineOptions>,
): number[] {
  const options: StreamlineOptions = { ...DEFAULT_STREAMLINE_OPTIONS, ...opts };
  const ghostAngles: number[] = [];

  for (const line of realLines) {
    if (line.length === 0) continue;

    const anchor = findGhostAnchorOnRealLine(
      line,
      observationTime,
      history,
      charge,
      config,
    );

    if (anchor !== null) {
      const theta0 = Math.atan2(anchor.y - ghostPos.y, anchor.x - ghostPos.x);
      ghostAngles.push(
        solveGhostSeedAngle(
          anchor, ghostPos, observationTime,
          ghostHistory, charge, config, bounds, options, theta0,
        ),
      );
      continue;
    }

    // No settled anchor found — fall back to analytic aberration formula.
    const seed = line[0];
    const realSeedAngle = Math.atan2(seed.y - sourcePos.y, seed.x - sourcePos.x);
    ghostAngles.push(analyticGhostSeedAngle(realSeedAngle, ghostVel, config.c));
  }

  return ghostAngles;
}

/**
 * Build a temporary ChargeHistory for a ghost charge moving at constant velocity.
 *
 * The ghost represents the charge's extrapolated would-have-been trajectory after
 * the sudden stop. Its history is seeded backward from `currentTime` using
 * constant-velocity kinematics so the retarded-time solver can bracket any
 * observation point within the view.
 *
 * @param ghostPos      Ghost position at `currentTime`.
 * @param ghostVel      Ghost velocity (constant — no acceleration for the ghost).
 * @param currentTime   Simulation time of the paused frame.
 * @param historyWindow Seconds of history to seed (should cover view light-crossing time).
 */
export function buildGhostHistory(
  ghostPos: Vec2,
  ghostVel: Vec2,
  currentTime: number,
  historyWindow: number,
): ChargeHistory {
  const history = new ChargeHistory();
  const dt = 0.05;
  const n = Math.ceil(historyWindow / dt) + 2;
  // Seed states from (currentTime − n*dt) to currentTime at uniform spacing.
  for (let i = -n; i <= 0; i++) {
    const t = currentTime + i * dt;
    history.recordState({
      t,
      pos: { x: ghostPos.x + ghostVel.x * i * dt, y: ghostPos.y + ghostVel.y * i * dt },
      vel: { x: ghostVel.x, y: ghostVel.y },
      accel: { x: 0, y: 0 },
    });
  }
  return history;
}

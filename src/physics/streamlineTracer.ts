// Streamline tracer for paused-frame LW field visualization (M9).
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

import { evaluateLienardWiechertField } from './lienardWiechert';
import { ChargeHistory } from './chargeHistory';
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
  history: ChargeHistory,
  charge: number,
  config: SimConfig,
  velocityOnly: boolean,
  minFieldMagnitude: number,
): Vec2 | null {
  const result = evaluateLienardWiechertField({
    observationPos: pos,
    observationTime,
    history,
    charge,
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
  history: ChargeHistory,
  charge: number,
  config: SimConfig,
  velocityOnly: boolean,
  stepSize: number,
  directionSign: number,
  minFieldMagnitude: number,
): Vec2 | null {
  const eval_ = (p: Vec2) =>
    evalNormalizedField(p, observationTime, history, charge, config, velocityOnly, minFieldMagnitude);

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
  history: ChargeHistory,
  charge: number,
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
      current, observationTime, history, charge, config,
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
 * @param opts           Optional overrides for trace parameters.
 * @param velocityOnly   Trace only the velocity (Coulomb-like) E-field component.
 *                       Pass true for ghost-charge streamlines.
 */
export function buildStreamlines(
  chargePos: Vec2,
  observationTime: number,
  history: ChargeHistory,
  charge: number,
  config: SimConfig,
  bounds: TraceBounds,
  opts?: Partial<StreamlineOptions>,
  velocityOnly = false,
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
  // Positive charge: trace in field direction (+1). Negative: reverse (−1).
  const dirSign = charge >= 0 ? 1 : -1;

  for (let i = 0; i < options.seedCount; i++) {
    const angle = (i / options.seedCount) * Math.PI * 2;
    const seed: Vec2 = {
      x: chargePos.x + options.seedOffsetRadius * Math.cos(angle),
      y: chargePos.y + options.seedOffsetRadius * Math.sin(angle),
    };
    const line = traceSingleLine(
      seed, observationTime, history, charge, config,
      paddedBounds, dirSign, options, velocityOnly,
    );
    if (line.length >= 4) {
      lines.push(line);
    }
  }

  return lines;
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

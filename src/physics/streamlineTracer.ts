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
  /**
   * Whether `traceSingleLine` consults `shouldStopForUnderresolvedTrace` at
   * each candidate step. Default true: protects periodic-radiation-mode
   * topologies (oscillating, dipole, hydrogen, water modes) where field lines
   * can wind around an under-resolved null. Callers that trace through a
   * legitimate sharp-but-non-spiraling discontinuity — notably the
   * moving_charge radiation shell — should explicitly pass `false`.
   */
  enableUnderresolvedGuard: boolean;
};

export const DEFAULT_STREAMLINE_OPTIONS: StreamlineOptions = {
  stepSize: 0.035,
  maxSteps: 350,
  minFieldMagnitude: 0.002,
  seedOffsetRadius: 0.12,
  seedCount: 16,
  enableUnderresolvedGuard: true,
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
 * True when `pt` is within `radius` of any sink position. Used by
 * `traceSingleLine` to stop a multi-charge trace cleanly as it enters the
 * neighbourhood of an opposite-sign charge, rather than letting the line
 * overshoot through the softened singularity and oscillate.
 */
function inSinkRadius(pt: Vec2, sinks: Vec2[] | undefined, radius: number): boolean {
  if (!sinks || sinks.length === 0) return false;
  const r2 = radius * radius;
  for (const s of sinks) {
    const dx = pt.x - s.x;
    const dy = pt.y - s.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

// ── Under-resolved-trace guard ───────────────────────────────────────────────
//
// Fixed-step RK4 streamline tracing on a normalized E direction can wind
// repeatedly into a tight visual spiral around an under-resolved null /
// X-point of the field, even though the true field is divergence-free in
// source-free space and so cannot contain a real spiral focus. The guard
// below stops a trace before accepting a proposed point when the local
// geometry indicates RK4 with the current `stepSize` is no longer resolving
// the field.
//
// Two detectors, both visual / numerical heuristics — not physical
// impossibility claims. Real time-dependent LW fields can have legitimate
// sharp local direction changes near radiation features and nulls; the
// thresholds are tuned to allow those through and only flag geometry that
// is clearly the under-resolved-orbit failure mode.
//
//   • Tortuosity — primary defense. The chord from `next` back to the
//     point WINDOW segments ago is short relative to the known arc length
//     over that window (chord/arc < MIN_CHORD_FRACTION ↔ ~235° accumulated
//     arc in 8 steps). Catches the slow tight winding pattern that the
//     spiral failure mode produces, while well-resolved closed loops
//     (≈ 22+ steps / revolution at the default DEFAULT_STREAMLINE_OPTIONS
//     for water modes at c = 1, ω = 4) pass unchanged.
//
//   • Near-reversal kink — secondary. The per-step angle between the last
//     accepted segment and the proposed segment exceeds 120° (dot < -0.5).
//     Catches the "trace bounced back" artifact of RK4 overshooting a
//     saddle and reversing direction within a single step. The threshold
//     is intentionally permissive: ordinary 60–120° physical turns
//     (radiation-band crossings, sudden-stop shells) pass through, and
//     only effectively-reversing rotations are flagged.
const KINK_DOT_THRESHOLD  = -0.5;
const TORTUOSITY_WINDOW   = 8;
const MIN_CHORD_FRACTION  = 0.42;

/**
 * Visual / numerical heuristic guard for fixed-step streamline tracing.
 * Returns true when the proposed next step indicates the trace is no
 * longer resolving the underlying field. Both branches are heuristics,
 * not physical-impossibility classifiers: detached / closed E-field loops
 * are legitimate (`curl E = −∂B/∂t` allows them in source-free space) and
 * real LW fields can have sharp local direction changes near radiation
 * features and nulls. The thresholds are tuned to flag only the under-
 * resolved-orbit failure mode and near-reversal/bounce artifacts.
 *
 * Thresholds:
 *   • Tortuosity (primary) over TORTUOSITY_WINDOW = 8 steps: chord/arc
 *     < 0.42 corresponds to roughly 235–240° of arc within the window.
 *     (Crossover follows `chord/arc = 2 sin(θ/2) / θ`.) Well-resolved
 *     closed loops (~22+ steps/revolution at the default
 *     DEFAULT_STREAMLINE_OPTIONS) pass unchanged.
 *   • KINK_DOT_THRESHOLD = -0.5 (secondary) — per-step rotation > 120° is
 *     interpreted as a near-reversal/bounce, the artifact of RK4
 *     overshooting a saddle and reversing direction within a single step.
 *     Ordinary 60–120° physical turns (radiation-band crossings,
 *     sudden-stop shells) pass through.
 *
 * Cheap O(1): mul/add/sqrt/dot only — no acos/atan2 in the hot loop.
 *
 * @param points    Accepted in-bounds polyline points so far. The last
 *                  element equals `current` in the normal tracer flow.
 * @param current   The latest accepted point. Passed explicitly so the
 *                  helper's contract is self-documenting and so the guard
 *                  is well-defined when `points` is empty.
 * @param next      The candidate next point proposed by rk4Step.
 * @param stepSize  Per-step arc length used by the tracer. Tortuosity
 *                  threshold scales with this so the guard is consistent
 *                  across step sizes. Non-positive values disable the
 *                  tortuosity branch defensively.
 */
export function shouldStopForUnderresolvedTrace(
  points: Vec2[],
  current: Vec2,
  next: Vec2,
  stepSize: number,
): boolean {
  // Near-reversal kink — needs the previous accepted segment, so
  // points.length >= 2 (points[len-2] → current is the previous segment).
  if (points.length >= 2) {
    const prev = points[points.length - 2];
    const ax = current.x - prev.x;
    const ay = current.y - prev.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;
    const aMag2 = ax * ax + ay * ay;
    const bMag2 = bx * bx + by * by;
    if (aMag2 > 1e-24 && bMag2 > 1e-24) {
      const dot = (ax * bx + ay * by) / Math.sqrt(aMag2 * bMag2);
      if (dot < KINK_DOT_THRESHOLD) return true;
    }
  }

  // Tortuosity — chord from `next` back to points[len - WINDOW] compared to
  // (WINDOW × stepSize × MIN_CHORD_FRACTION)². WINDOW counts segments: the
  // (WINDOW-1) accepted segments from points[len-WINDOW] up to current,
  // plus the candidate segment current → next.
  if (stepSize > 0 && points.length >= TORTUOSITY_WINDOW) {
    const back = points[points.length - TORTUOSITY_WINDOW];
    const dx = next.x - back.x;
    const dy = next.y - back.y;
    const chordSq = dx * dx + dy * dy;
    const minChord = TORTUOSITY_WINDOW * stepSize * MIN_CHORD_FRACTION;
    if (chordSq < minChord * minChord) return true;
  }

  return false;
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
 *
 * If `sinks` is non-empty, the trace also stops once the current position is
 * within `opts.seedOffsetRadius` of any sink — used in multi-charge mode so a
 * + seeded line terminates cleanly at the − charge it is approaching rather
 * than overshooting through the softened singularity and oscillating. The
 * inside-sink point is recorded as the final polyline point so the rendered
 * line visibly arrives at the sink.
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
  sinks?: Vec2[],
): Vec2[] {
  const points: Vec2[] = [];
  let current: Vec2 = { x: seed.x, y: seed.y };
  let hasEnteredBounds = false;
  let enteredSink = false;

  for (let i = 0; i < opts.maxSteps; i++) {
    const inside = inBounds(current, bounds);
    if (!inside && hasEnteredBounds) break;

    if (inside) {
      hasEnteredBounds = true;
      points.push({ x: current.x, y: current.y });
    }

    // Stop only after recording the inside-sink point so the polyline visibly
    // reaches the sink. enteredSink is set on the previous iteration's step.
    if (enteredSink) break;

    const next = rk4Step(
      current, observationTime, chargeRuntimes, config,
      velocityOnly, opts.stepSize, directionSign, opts.minFieldMagnitude,
    );
    if (!next) break;

    // Sink-entry takes strict priority over the under-resolved guard so a
    // line that bends sharply right as it arrives at a sink still terminates
    // at the sink point rather than being rejected by the kink/tortuosity
    // heuristic.
    const nextEntersSink = inSinkRadius(next, sinks, opts.seedOffsetRadius);
    if (!nextEntersSink &&
        opts.enableUnderresolvedGuard &&
        shouldStopForUnderresolvedTrace(points, current, next, opts.stepSize)) {
      break;
    }

    current = next;
    if (nextEntersSink) enteredSink = true;
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
 * @param sinks            Optional world-space positions of opposite-sign charges that
 *                         should terminate the trace cleanly. When a traced position
 *                         enters `opts.seedOffsetRadius` of any sink the line stops
 *                         on that point. Used by the multi-charge field-line policy
 *                         so + seeded lines arrive at − charges without overshooting
 *                         and oscillating through the softened singularity.
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
  sinks?: Vec2[],
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
      paddedBounds, dirSign, options, velocityOnly, sinks,
    );
    if (line.length >= 4) {
      // Reverse for negative sources so the polyline's stroke direction
      // (line[0] → line[n-1]) matches the local E field direction. The trace
      // runs outward in either case (so the line geometry is visible), but for
      // q < 0 the field points inward; flipping the array makes segment-based
      // arrow tick-marks render in the correct direction.
      if (dirSign < 0) line.reverse();
      lines.push(line);
    }
  }

  return lines;
}

/**
 * Pick which charges to seed field lines from in the BASE source-to-sink
 * trace pass of the multi-charge field-line policy.
 *
 * Convention: a 2D field line begins on a + charge and ends on a − charge.
 * Seeding only the + sources for this pass avoids the perimeter clustering
 * an earlier per-charge seeding policy produced by tracing each closed line
 * once from each end. If the system has no + charges, the helper falls back
 * to seeding the − charges with `dirSign=-1` so each line traces outward
 * against E from its source — the rendered polyline is then reversed in
 * `buildStreamlines` so tick-marks point in the local E direction, matching
 * the existing single-charge convention.
 *
 * The base pass alone does NOT render every visible piece of the field-line
 * structure: in a net-neutral multi-charge system, closed lines whose +
 * source-side trace exits the finite trace region (padded view bounds,
 * `maxSteps`, or under-resolved-trace guard) before reaching a − sink show
 * up only as escape-from-+ stubs with no visible approach to −. The
 * companion helper `buildSinkSideEscapeCompletions` draws those missing
 * sink-side portions; together the two passes form the multi-charge field-
 * line policy used by `StreamlineCanvas`. For dipole, hydrogen, and the
 * water modes the two passes give symmetric coverage; for single-polarity
 * systems only this base pass runs.
 *
 * Returns an empty array when the input is empty or all charges are zero.
 */
export function selectFieldLineSources(
  chargeRuntimes: ChargeRuntime[],
): { runtime: ChargeRuntime; dirSign: number }[] {
  const positives = chargeRuntimes.filter(r => r.charge > 0);
  if (positives.length > 0) {
    return positives.map(runtime => ({ runtime, dirSign: +1 }));
  }
  const negatives = chargeRuntimes.filter(r => r.charge < 0);
  if (negatives.length > 0) {
    return negatives.map(runtime => ({ runtime, dirSign: -1 }));
  }
  return [];
}

/**
 * Completes the sink-side portions of source-traced field lines whose
 * source-side polyline exited the finite trace region (padded view bounds,
 * `maxSteps`, or under-resolved-trace guard) before reaching its sink.
 * Without this pass, those lines appear in the rendered set as
 * escape-from-+ stubs with no visible mirror approaching −.
 *
 * Operates only on net-neutral multi-charge systems; for non-neutral or
 * single-charge systems returns `[]`. Each kept polyline ends inside
 * `seedOffsetRadius` of a − charge and starts (after the `dirSign < 0`
 * reversal in `buildStreamlines`) far from any + — which identifies a
 * sink-side completion whose source-side counterpart did not reach this
 * sink within the finite trace budget.
 *
 * Mechanism: for each − charge, seed `seedCount` lines at `seedOffsetRadius`
 * around its newest position and trace with `dirSign = -1` (outward against
 * the local E field at −, since the field points inward there). The
 * positive newest positions are passed as `sinks` so closed `−→+` traces
 * cleanly terminate inside `seedOffsetRadius` of a +. The post-trace filter
 * then drops every polyline whose far end sits inside that radius — those
 * are the closed lines already drawn by the base source pass; keeping them
 * would re-introduce the perimeter clustering that the source-only seeding
 * policy was added to fix. The lines that survive the filter are the
 * sink-side completions. Polyline orientation is set by the `dirSign < 0`
 * reversal inside `buildStreamlines`, so the rendered stroke direction
 * matches local E (incoming to −) and the existing tick-mark renderer
 * draws arrows pointing INTO the − charge.
 *
 * Forwards `opts` so a stopped-shell tracing policy
 * (`enableUnderresolvedGuard: false`) propagates correctly when called
 * from a stopped frame.
 */
export function buildSinkSideEscapeCompletions(
  chargeRuntimes: ChargeRuntime[],
  observationTime: number,
  config: SimConfig,
  bounds: TraceBounds,
  opts?: Partial<StreamlineOptions>,
): Vec2[][] {
  if (chargeRuntimes.length < 2) return [];

  let totalCharge = 0;
  for (const r of chargeRuntimes) totalCharge += r.charge;
  if (Math.abs(totalCharge) > 1e-6) return [];

  // Positive newest positions serve two purposes: as sinks for the backward
  // trace (so closed −→+ paths terminate cleanly at +), and as filter
  // targets (so those closed-line duplicates can be dropped post-trace).
  const positivePositions: Vec2[] = [];
  for (const r of chargeRuntimes) {
    if (r.charge > 0 && !r.history.isEmpty()) {
      positivePositions.push(r.history.newest()!.pos);
    }
  }
  if (positivePositions.length === 0) return [];

  const options: StreamlineOptions = { ...DEFAULT_STREAMLINE_OPTIONS, ...opts };
  const filterRadiusSq = options.seedOffsetRadius * options.seedOffsetRadius;

  const lines: Vec2[][] = [];
  for (const r of chargeRuntimes) {
    if (r.charge >= 0 || r.history.isEmpty()) continue;
    const sinkPos = r.history.newest()!.pos;

    const traced = buildStreamlines(
      sinkPos, observationTime, chargeRuntimes, config, bounds,
      opts, false, undefined, -1, positivePositions,
    );

    for (const line of traced) {
      // After the dirSign<0 reversal inside buildStreamlines, line[0] is
      // the "far" end of the original backward trace from −. If that far
      // end is inside seedOffsetRadius of any +, the trace closed on a +
      // and the polyline is a duplicate of a base-pass line — drop it.
      const farEnd = line[0];
      let nearPositive = false;
      for (const p of positivePositions) {
        const dx = farEnd.x - p.x;
        const dy = farEnd.y - p.y;
        if (dx * dx + dy * dy <= filterRadiusSq) {
          nearPositive = true;
          break;
        }
      }
      if (!nearPositive) lines.push(line);
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

/**
 * Scan along a real streamline for the first point that lies on the settled
 * outer branch of the radiation shell — the point used to anchor a matching
 * ghost-charge streamline. A point qualifies once the acceleration-field
 * contribution has first risen through the band (`accelRatio ≥ 0.12`) and
 * then fallen back below `0.05` for `GHOST_EXIT_RUN_LENGTH` consecutive
 * samples. Returns null when the line never settles within the traced span.
 *
 * Exported so the moving-charge regression test can directly assert that the
 * upstream precondition for accurate ghost seed-angle matching holds (rather
 * than only checking the final ghost-line geometry, which is downstream of
 * both this anchor and the numeric seed-angle solve).
 */
export function findGhostAnchorOnRealLine(
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

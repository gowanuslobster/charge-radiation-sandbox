import { describe, expect, it } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import type { ChargeRuntime } from './chargeRuntime';
import type { SimConfig, Vec2 } from './types';
import {
  buildStreamlines,
  findGhostAnchorOnRealLine,
  selectFieldLineSources,
  shouldStopForUnderresolvedTrace,
} from './streamlineTracer';

function makeStaticChargeRuntime(charge: number, posX = 0, posY = 0): ChargeRuntime {
  const history = new ChargeHistory();
  // Seed enough static history so the retarded-time solver always succeeds.
  for (let i = -20; i <= 0; i++) {
    history.recordState({
      t: i * 0.05,
      pos: { x: posX, y: posY },
      vel: { x: 0, y: 0 },
      accel: { x: 0, y: 0 },
    });
  }
  return { history, charge };
}

const config: SimConfig = { c: 1.0, softening: 0.01 };
const bounds = { minX: -3, maxX: 3, minY: -3, maxY: 3 };

describe('buildStreamlines — polyline orientation matches E direction', () => {
  it('positive charge: line runs outward (line[0] near, line[end] far)', () => {
    const runtime = makeStaticChargeRuntime(+1);
    const lines = buildStreamlines(
      { x: 0, y: 0 }, 0, [runtime], config, bounds,
      { seedCount: 8, maxSteps: 80, stepSize: 0.05, seedOffsetRadius: 0.12, minFieldMagnitude: 0.0005 },
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const r0   = Math.hypot(line[0].x, line[0].y);
      const rEnd = Math.hypot(line[line.length - 1].x, line[line.length - 1].y);
      expect(rEnd).toBeGreaterThan(r0);
    }
  });

  it('negative charge: line runs inward (line[0] far, line[end] near)', () => {
    const runtime = makeStaticChargeRuntime(-1);
    const lines = buildStreamlines(
      { x: 0, y: 0 }, 0, [runtime], config, bounds,
      { seedCount: 8, maxSteps: 80, stepSize: 0.05, seedOffsetRadius: 0.12, minFieldMagnitude: 0.0005 },
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const r0   = Math.hypot(line[0].x, line[0].y);
      const rEnd = Math.hypot(line[line.length - 1].x, line[line.length - 1].y);
      // For a negative charge, the local E field points toward the source,
      // so the polyline's stroke direction must run toward the charge — i.e.
      // line[end] is closer to the source than line[0].
      expect(rEnd).toBeLessThan(r0);
    }
  });

  it('negative charge: each segment heading points inward (toward charge)', () => {
    const runtime = makeStaticChargeRuntime(-1);
    const lines = buildStreamlines(
      { x: 0, y: 0 }, 0, [runtime], config, bounds,
      { seedCount: 8, maxSteps: 80, stepSize: 0.05, seedOffsetRadius: 0.12, minFieldMagnitude: 0.0005 },
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // Sample several non-adjacent segments to dodge any near-source noise.
      for (let i = 0; i + 5 < line.length; i += Math.max(1, Math.floor(line.length / 4))) {
        const a = line[i];
        const b = line[i + 5];
        // Vector from a → b should have a negative dot product with a's outward
        // radial vector — i.e. the heading is inward.
        const radialDot = (b.x - a.x) * a.x + (b.y - a.y) * a.y;
        expect(radialDot).toBeLessThan(0);
      }
    }
  });
});

describe('selectFieldLineSources — multi-charge seeding policy', () => {
  it('single positive charge: returns that charge with dirSign +1', () => {
    const r = makeStaticChargeRuntime(+1);
    const sources = selectFieldLineSources([r]);
    expect(sources).toHaveLength(1);
    expect(sources[0].runtime).toBe(r);
    expect(sources[0].dirSign).toBe(+1);
  });

  it('single negative charge: returns that charge with dirSign −1', () => {
    const r = makeStaticChargeRuntime(-1);
    const sources = selectFieldLineSources([r]);
    expect(sources).toHaveLength(1);
    expect(sources[0].runtime).toBe(r);
    expect(sources[0].dirSign).toBe(-1);
  });

  it('dipole (+ and −): seeds only the positive', () => {
    const rPos = makeStaticChargeRuntime(+1, -1, 0);
    const rNeg = makeStaticChargeRuntime(-1, +1, 0);
    const sources = selectFieldLineSources([rPos, rNeg]);
    expect(sources).toHaveLength(1);
    expect(sources[0].runtime).toBe(rPos);
    expect(sources[0].dirSign).toBe(+1);
  });

  it('water-shaped (− and two +): seeds both positives', () => {
    const rO  = makeStaticChargeRuntime(-0.8, 0, 0);
    const rH1 = makeStaticChargeRuntime(+0.4, -0.5, -0.4);
    const rH2 = makeStaticChargeRuntime(+0.4, +0.5, -0.4);
    const sources = selectFieldLineSources([rO, rH1, rH2]);
    expect(sources).toHaveLength(2);
    expect(sources.map(s => s.runtime)).toEqual(expect.arrayContaining([rH1, rH2]));
    expect(sources.every(s => s.dirSign === +1)).toBe(true);
  });

  it('all-negative system: falls back to seeding all negatives with dirSign −1', () => {
    const r1 = makeStaticChargeRuntime(-1, -1, 0);
    const r2 = makeStaticChargeRuntime(-1, +1, 0);
    const sources = selectFieldLineSources([r1, r2]);
    expect(sources).toHaveLength(2);
    expect(sources.every(s => s.dirSign === -1)).toBe(true);
  });

  it('empty input: returns empty array', () => {
    expect(selectFieldLineSources([])).toEqual([]);
  });
});

describe('buildStreamlines — sink termination', () => {
  it('+ → − trace stops on entering the sink radius', () => {
    // Static dipole: + at (-1, 0), − at (+1, 0). Seed one line from + along
    // +x (angle 0) so it traces straight toward the − sink. Assert the four
    // clauses of the sink-termination contract: stopped before maxSteps; last
    // point is inside the sink radius; the prior point is still outside; and
    // no earlier point ever entered the sink radius (the line did not pass
    // through the sink).
    const rPos = makeStaticChargeRuntime(+1, -1, 0);
    const rNeg = makeStaticChargeRuntime(-1, +1, 0);
    const sinkPos = { x: +1, y: 0 };
    const seedOffsetRadius = 0.12;
    const maxSteps = 300;

    const lines = buildStreamlines(
      { x: -1, y: 0 }, 0, [rPos, rNeg], config,
      { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      { seedCount: 1, maxSteps, stepSize: 0.035, seedOffsetRadius, minFieldMagnitude: 0.001 },
      false,
      [0],          // single seed at angle 0 → seed at (-1 + 0.12, 0), points at sink
      +1,           // dirSign: trace along +E
      [sinkPos],    // − charge is the sink
    );

    expect(lines).toHaveLength(1);
    const line = lines[0];

    // (a) Stopped well before maxSteps.
    expect(line.length).toBeLessThan(maxSteps);
    expect(line.length).toBeGreaterThanOrEqual(4);

    const distTo = (p: { x: number; y: number }) =>
      Math.hypot(p.x - sinkPos.x, p.y - sinkPos.y);

    // (b) Last point is inside the sink radius.
    expect(distTo(line[line.length - 1])).toBeLessThanOrEqual(seedOffsetRadius);

    // (c) Previous point is still outside — proves the stop fired on the
    // sink-entry step, not on an earlier weak-field or bounds exit.
    expect(distTo(line[line.length - 2])).toBeGreaterThan(seedOffsetRadius);

    // (d) No earlier point is inside the sink radius — proves the line
    // arrived from outside rather than passing through and re-entering.
    for (let i = 0; i < line.length - 1; i++) {
      expect(distTo(line[i])).toBeGreaterThan(seedOffsetRadius);
    }
  });
});

describe('buildStreamlines — moving_charge stop-shell regression', () => {
  // Tracer-level fixture that reproduces the moving_charge sudden-stop
  // history in-test from primitives (mirrors `sampleSuddenStopState`; not
  // imported so the tracer test stays free of demoModes coupling).
  //
  // Locks the precondition that fails when the under-resolved-trace guard
  // fires across the radiation shell:
  //   • Most real seed lines extend past the shell margin around the rest
  //     position (measured from the stopped charge, not the world origin).
  //   • For those same lines, `findGhostAnchorOnRealLine` returns a
  //     non-null settled-outer-branch anchor — the actual upstream
  //     condition for accurate ghost-line seed-angle matching.
  it('real lines reach past shell margin and ghost anchors are findable (guard off)', () => {
    const V       = 0.6;
    const T_BRAKE = 0.2;
    const T_trig  = 1.0;
    const t_obs   = 3.0;
    const cVal    = 1.0;

    // Rest position of the stopped charge.
    const xStop = V * T_trig + V * T_BRAKE / 2;

    // Shell-margin distance: two brake-window thicknesses past the leading
    // edge — a deliberately conservative margin so the assertion is
    // comfortably outside the radiation band. The shell band itself spans
    // [c·(t_obs − brakeEnd), c·(t_obs − T_trig)] and so has thickness
    // c·T_BRAKE; the assertion adds 2·c·T_BRAKE past the outer edge. All
    // distances are measured from the rest position of the stopped charge
    // so the fixture stays valid if T_trig or V change.
    const shellLeadingEdgeRadius = cVal * (t_obs - T_trig);
    const shellMargin            = shellLeadingEdgeRadius + 2 * cVal * T_BRAKE;

    // Cover retarded-time look-back from the farthest in-bounds trace
    // point with margin to spare.
    const history = new ChargeHistory();
    const dt = 0.025;
    const tStart = -8;
    const N = Math.round((t_obs - tStart) / dt);
    for (let i = 0; i <= N; i++) {
      const t = tStart + i * dt;
      let pos: Vec2, vel: Vec2, accel: Vec2;
      if (t < T_trig) {
        pos   = { x: V * t, y: 0 };
        vel   = { x: V,     y: 0 };
        accel = { x: 0,     y: 0 };
      } else if (t < T_trig + T_BRAKE) {
        const elapsed    = t - T_trig;
        const brakeAccel = -V / T_BRAKE;
        pos   = {
          x: V * T_trig + V * elapsed + 0.5 * brakeAccel * elapsed * elapsed,
          y: 0,
        };
        vel   = { x: V + brakeAccel * elapsed, y: 0 };
        accel = { x: brakeAccel,               y: 0 };
      } else {
        pos   = { x: xStop, y: 0 };
        vel   = { x: 0,     y: 0 };
        accel = { x: 0,     y: 0 };
      }
      history.recordState({ t, pos, vel, accel });
    }

    const runtime: ChargeRuntime = { history, charge: +1 };
    const cfg: SimConfig = { c: cVal, softening: 0.01 };
    const traceBounds = { minX: -3, maxX: 4, minY: -3, maxY: 3 };
    const seedCount = 16;

    const lines = buildStreamlines(
      { x: xStop, y: 0 }, t_obs, [runtime], cfg, traceBounds,
      { enableUnderresolvedGuard: false, seedCount },
    );

    // Most seeds should produce a traceable line in the first place.
    expect(lines.length).toBeGreaterThanOrEqual(14);

    let reachedFar    = 0;
    let anchorsFound  = 0;
    for (const line of lines) {
      const reached = line.some(p =>
        Math.hypot(p.x - xStop, p.y) >= shellMargin,
      );
      if (reached) reachedFar++;

      const anchor = findGhostAnchorOnRealLine(line, t_obs, history, +1, cfg);
      if (anchor !== null) anchorsFound++;
    }

    expect(reachedFar).toBeGreaterThanOrEqual(14);
    expect(anchorsFound).toBeGreaterThanOrEqual(14);
  });
});

describe('buildStreamlines — oscillating stop-shell regression', () => {
  // Tracer-level fixture mirroring an oscillating-mode sudden-stop history
  // (sinusoidal motion until T_trig, Hermite-cubic brake to rest over
  // T_BRAKE, then at rest at the equilibrium origin). Constructed from
  // primitives so the tracer test stays free of demoModes coupling.
  //
  // Pins the user-visible behavior of the stopped-shell tracing policy
  // adopted by StreamlineCanvas: when a mode has been stopped, the
  // under-resolved-trace guard is disabled so lines can cross the
  // finite-thickness radiation shell (where the LW acceleration-term field
  // is mostly tangential and would otherwise trip the tortuosity branch
  // before the line emerges on the outside). An adaptive future guard
  // that hits the same target through a different mechanism would still
  // pass — this test pins the user-visible reach, not the particular
  // guard parameters.
  it('lines reach past shell margin under stopped-shell tracing policy (guard off)', () => {
    // Match production OSCILLATING_AMPLITUDE / OSCILLATING_OMEGA /
    // SUDDEN_STOP_T_BRAKE; see src/physics/demoModes.ts.
    const A       = 0.125;
    const omega   = 4.0;
    const T_BRAKE = 0.2;
    const T_trig  = 1.0;
    const t_obs   = 3.0;
    const cVal    = 1.0;

    // Equilibrium / rest position of the oscillating charge is the origin.
    const xRest = 0;
    const yRest = 0;

    // Shell-margin distance: two brake-window thicknesses past the leading
    // edge — same conservative margin as the moving-charge fixture above so
    // both tests share a single notion of "lines reach past the shell". The
    // shell band itself spans [c·(t_obs − brakeEnd), c·(t_obs − T_trig)]
    // and so has thickness c·T_BRAKE; the assertion adds 2·c·T_BRAKE past
    // the outer edge. Measured from the rest position.
    const shellLeadingEdgeRadius = cVal * (t_obs - T_trig);
    const shellMargin            = shellLeadingEdgeRadius + 2 * cVal * T_BRAKE;

    const history = new ChargeHistory();
    const dt = 0.025;
    const tStart = -10;
    const N = Math.round((t_obs - tStart) / dt);
    const brakeEnd = T_trig + T_BRAKE;
    for (let i = 0; i <= N; i++) {
      const t = tStart + i * dt;
      let pos: Vec2, vel: Vec2, accel: Vec2;
      if (t < T_trig) {
        // Phase 1 — pre-trigger sinusoidal motion along x.
        pos   = { x: A * Math.sin(omega * t),                    y: 0 };
        vel   = { x: A * omega * Math.cos(omega * t),            y: 0 };
        accel = { x: -A * omega * omega * Math.sin(omega * t),   y: 0 };
      } else if (t < brakeEnd) {
        // Phase 2 — Hermite cubic brake in the scalar amplitude.
        const tau   = (t - T_trig) / T_BRAKE;
        const s0    = A * Math.sin(omega * T_trig);
        const sDot0 = A * omega * Math.cos(omega * T_trig);
        const f   = s0    * (2 * tau ** 3 - 3 * tau ** 2 + 1)
                  + sDot0 * T_BRAKE * (tau ** 3 - 2 * tau ** 2 + tau);
        const fp  = s0    * (6 * tau ** 2 - 6 * tau)
                  + sDot0 * T_BRAKE * (3 * tau ** 2 - 4 * tau + 1);
        const fpp = s0    * (12 * tau - 6)
                  + sDot0 * T_BRAKE * (6 * tau - 4);
        pos   = { x: f,                          y: 0 };
        vel   = { x: fp / T_BRAKE,               y: 0 };
        accel = { x: fpp / (T_BRAKE * T_BRAKE),  y: 0 };
      } else {
        // Phase 3 — at rest at equilibrium.
        pos   = { x: xRest, y: yRest };
        vel   = { x: 0,     y: 0 };
        accel = { x: 0,     y: 0 };
      }
      history.recordState({ t, pos, vel, accel });
    }

    const runtime: ChargeRuntime = { history, charge: +1 };
    const cfg: SimConfig = { c: cVal, softening: 0.01 };
    const traceBounds = { minX: -3, maxX: 3, minY: -3, maxY: 3 };
    const seedCount = 16;

    // Match the production policy: StreamlineCanvas disables the guard for
    // any stopped-state frame so the line can traverse the radiation shell.
    const lines = buildStreamlines(
      { x: xRest, y: yRest }, t_obs, [runtime], cfg, traceBounds,
      { enableUnderresolvedGuard: false, seedCount },
    );

    expect(lines.length).toBeGreaterThanOrEqual(14);

    let reachedFar = 0;
    for (const line of lines) {
      const reached = line.some(p =>
        Math.hypot(p.x - xRest, p.y - yRest) >= shellMargin,
      );
      if (reached) reachedFar++;
    }
    expect(reachedFar).toBeGreaterThanOrEqual(14);
  });
});

describe('shouldStopForUnderresolvedTrace — numerical validity guard', () => {
  const STEP = 0.035;

  // Build N collinear points along +x spaced `step` apart, starting at (0, 0).
  function collinearPoints(n: number, step = STEP): Vec2[] {
    const pts: Vec2[] = [];
    for (let i = 0; i < n; i++) pts.push({ x: i * step, y: 0 });
    return pts;
  }

  // Build N points on a circle of radius `r` with per-step chord = `step`.
  // The resulting per-step angular increment is `2*asin(step/(2*r))`.
  // Points are evenly spaced angularly starting at angle 0.
  function circlePoints(n: number, r: number, step = STEP): Vec2[] {
    const dTheta = 2 * Math.asin(step / (2 * r));
    const pts: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      pts.push({ x: r * Math.cos(i * dTheta), y: r * Math.sin(i * dTheta) });
    }
    return pts;
  }

  it('straight path: does not stop', () => {
    const points = collinearPoints(10);
    const current = points[points.length - 1];
    const next = { x: current.x + STEP, y: 0 };
    expect(shouldStopForUnderresolvedTrace(points, current, next, STEP)).toBe(false);
  });

  it('broad smooth arc (radius 2.0): does not stop', () => {
    const R = 2.0;
    const points = circlePoints(10, R);
    const current = points[points.length - 1];
    const dTheta = 2 * Math.asin(STEP / (2 * R));
    const nextTheta = (points.length) * dTheta;
    const next = { x: R * Math.cos(nextTheta), y: R * Math.sin(nextTheta) };
    expect(shouldStopForUnderresolvedTrace(points, current, next, STEP)).toBe(false);
  });

  it('near-reversal kink: stops via dot threshold (no tortuosity history needed)', () => {
    // Two prior points along +x then a 135° turn (well past the −0.5 dot
    // threshold; cos 135° ≈ −0.707). The tortuosity branch is inactive
    // because points.length < TORTUOSITY_WINDOW (=8).
    const points: Vec2[] = [{ x: -STEP, y: 0 }, { x: 0, y: 0 }];
    const current = points[1];
    const next = { x: -STEP * Math.SQRT1_2, y: STEP * Math.SQRT1_2 };
    expect(shouldStopForUnderresolvedTrace(points, current, next, STEP)).toBe(true);
  });

  it('moderate sharp turn (90°): does NOT stop (passes the −0.5 kink threshold)', () => {
    // Locks the new threshold semantics: a 90° turn is a legitimate sharp
    // physical change (e.g. a radiation-band crossing) and must pass the
    // guard. cos 90° = 0, well above the −0.5 dot threshold.
    const points: Vec2[] = [{ x: -STEP, y: 0 }, { x: 0, y: 0 }];
    const current = points[1];
    const next = { x: 0, y: STEP };
    expect(shouldStopForUnderresolvedTrace(points, current, next, STEP)).toBe(false);
  });

  it('tight orbit: stops via tortuosity even when every per-step turn is below the kink threshold', () => {
    // 8 points on a tight circle where each per-step turn is 40°
    // (dot ≈ cos 40° ≈ 0.766, far above the −0.5 kink threshold).
    // Total arc over the 8-step window: 320°, chord/arc ≈ 0.12 ≪ 0.42.
    const dThetaTarget = (40 * Math.PI) / 180;
    const R = STEP / (2 * Math.sin(dThetaTarget / 2));
    const points = circlePoints(8, R);
    const current = points[points.length - 1];
    const nextTheta = points.length * dThetaTarget;
    const next = { x: R * Math.cos(nextTheta), y: R * Math.sin(nextTheta) };

    // Sanity-check: no individual per-step rotation triggers the kink branch.
    for (let i = 1; i < points.length; i++) {
      const a = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y };
      const bMagPrev = i >= 2
        ? { x: points[i - 1].x - points[i - 2].x, y: points[i - 1].y - points[i - 2].y }
        : null;
      if (!bMagPrev) continue;
      const dot = (a.x * bMagPrev.x + a.y * bMagPrev.y)
        / (Math.hypot(a.x, a.y) * Math.hypot(bMagPrev.x, bMagPrev.y));
      expect(dot).toBeGreaterThan(-0.5);
    }
    // Also check the candidate segment's per-step dot is above the kink threshold,
    // so the assertion below is unambiguously about the tortuosity branch.
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const seg1 = { x: last.x - prev.x, y: last.y - prev.y };
    const seg2 = { x: next.x - last.x, y: next.y - last.y };
    const dotLast = (seg1.x * seg2.x + seg1.y * seg2.y)
      / (Math.hypot(seg1.x, seg1.y) * Math.hypot(seg2.x, seg2.y));
    expect(dotLast).toBeGreaterThan(-0.5);

    expect(shouldStopForUnderresolvedTrace(points, current, next, STEP)).toBe(true);
  });

  it('scale invariance: same proportional geometry gives the same decision at any stepSize', () => {
    // Tight orbit (40° per step) → expect stop at both step sizes.
    const dThetaTarget = (40 * Math.PI) / 180;
    for (const step of [0.01, 0.1]) {
      const R = step / (2 * Math.sin(dThetaTarget / 2));
      const pts = circlePoints(8, R, step);
      const current = pts[pts.length - 1];
      const nextTheta = pts.length * dThetaTarget;
      const next = { x: R * Math.cos(nextTheta), y: R * Math.sin(nextTheta) };
      expect(shouldStopForUnderresolvedTrace(pts, current, next, step)).toBe(true);
    }
    // Straight path → expect no-stop at both step sizes.
    for (const step of [0.01, 0.1]) {
      const pts = collinearPoints(10, step);
      const current = pts[pts.length - 1];
      const next = { x: current.x + step, y: 0 };
      expect(shouldStopForUnderresolvedTrace(pts, current, next, step)).toBe(false);
    }
  });

  it('insufficient history and defensive stepSize: short-circuits cleanly', () => {
    // (a) Empty points → false.
    expect(
      shouldStopForUnderresolvedTrace([], { x: 0, y: 0 }, { x: STEP, y: 0 }, STEP),
    ).toBe(false);

    // (b) One point, no prior segment → false.
    expect(
      shouldStopForUnderresolvedTrace(
        [{ x: 0, y: 0 }], { x: 0, y: 0 }, { x: STEP, y: 0 }, STEP,
      ),
    ).toBe(false);

    // (c) Length-3 with would-be-tortuous orbit geometry → still false
    //     because the window check requires points.length >= 8.
    const dThetaTarget = (40 * Math.PI) / 180;
    const R = STEP / (2 * Math.sin(dThetaTarget / 2));
    const pts3 = circlePoints(3, R);
    const current3 = pts3[pts3.length - 1];
    const nextTheta3 = 3 * dThetaTarget;
    const next3 = { x: R * Math.cos(nextTheta3), y: R * Math.sin(nextTheta3) };
    expect(shouldStopForUnderresolvedTrace(pts3, current3, next3, STEP)).toBe(false);

    // (d) Length-3 with a 135° near-reversal kink → true (kink branch is
    //     active at length ≥ 2). Prior segment heads +y; candidate segment
    //     heads (−√½, −√½), giving dot ≈ −0.707 < −0.5.
    const kinkPts: Vec2[] = [{ x: -STEP, y: 0 }, { x: 0, y: 0 }, { x: 0, y: STEP }];
    const dx = -STEP * Math.SQRT1_2;
    const dy = -STEP * Math.SQRT1_2;
    expect(
      shouldStopForUnderresolvedTrace(
        kinkPts, kinkPts[2], { x: kinkPts[2].x + dx, y: kinkPts[2].y + dy }, STEP,
      ),
    ).toBe(true);

    // (e) Otherwise-stop-worthy tortuosity geometry but stepSize ≤ 0 → false.
    const pts8 = circlePoints(8, R);
    const current8 = pts8[pts8.length - 1];
    const nextTheta8 = 8 * dThetaTarget;
    const next8 = { x: R * Math.cos(nextTheta8), y: R * Math.sin(nextTheta8) };
    expect(shouldStopForUnderresolvedTrace(pts8, current8, next8, 0)).toBe(false);
    expect(shouldStopForUnderresolvedTrace(pts8, current8, next8, -STEP)).toBe(false);
  });
});

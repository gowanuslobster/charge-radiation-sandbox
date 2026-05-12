import { describe, expect, it } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import type { ChargeRuntime } from './chargeRuntime';
import type { SimConfig, Vec2 } from './types';
import {
  buildStreamlines,
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

  it('hard kink: stops via dot threshold (no tortuosity history needed)', () => {
    // Two prior points along +x then a 90° turn into +y. Tortuosity branch is
    // inactive because points.length < TORTUOSITY_WINDOW (=8).
    const points: Vec2[] = [{ x: -STEP, y: 0 }, { x: 0, y: 0 }];
    const current = points[1];
    const next = { x: 0, y: STEP };
    expect(shouldStopForUnderresolvedTrace(points, current, next, STEP)).toBe(true);
  });

  it('tight orbit: stops via tortuosity even when every per-step turn is below the kink threshold', () => {
    // 8 points on a tight circle where each per-step turn is 40°
    // (dot ≈ cos 40° ≈ 0.766, well above the 0.5 kink threshold).
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
      expect(dot).toBeGreaterThan(0.5);
    }
    // Also check the candidate segment's per-step dot is above the kink threshold,
    // so the assertion below is unambiguously about the tortuosity branch.
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const seg1 = { x: last.x - prev.x, y: last.y - prev.y };
    const seg2 = { x: next.x - last.x, y: next.y - last.y };
    const dotLast = (seg1.x * seg2.x + seg1.y * seg2.y)
      / (Math.hypot(seg1.x, seg1.y) * Math.hypot(seg2.x, seg2.y));
    expect(dotLast).toBeGreaterThan(0.5);

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

    // (d) Length-3 with a 90° kink → true (kink branch is active at length ≥ 2).
    const kinkPts: Vec2[] = [{ x: -STEP, y: 0 }, { x: 0, y: 0 }, { x: 0, y: STEP }];
    expect(
      shouldStopForUnderresolvedTrace(
        kinkPts, kinkPts[2], { x: -STEP, y: STEP }, STEP,
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

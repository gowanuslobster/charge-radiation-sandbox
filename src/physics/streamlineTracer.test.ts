import { describe, expect, it } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import type { ChargeRuntime } from './chargeRuntime';
import type { SimConfig } from './types';
import { buildStreamlines, selectFieldLineSources } from './streamlineTracer';

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

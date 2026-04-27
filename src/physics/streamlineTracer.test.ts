import { describe, expect, it } from 'vitest';
import { ChargeHistory } from './chargeHistory';
import type { ChargeRuntime } from './chargeRuntime';
import type { SimConfig } from './types';
import { buildStreamlines } from './streamlineTracer';

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

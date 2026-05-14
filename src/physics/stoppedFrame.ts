// stoppedFrame.ts — pure helper for recording one stop-aware tick into every
// charge's history. Extracted from the ChargeRadiationSandbox simulation tick
// so the stop-aware history-recording branch is testable as a unit under the
// existing vitest harness (no React, no DOM).

import type { ChargeRuntime } from './chargeRuntime';
import type { KinematicState, SamplerBounds, SimConfig, Vec2 } from './types';
import {
  brakingSubstepTimes,
  maxHistorySpeed,
  sampleStoppedDemoChargeStates,
  type StoppableMode,
} from './demoModes';

/**
 * Maximum distance from a point to any of the four corners of a bounds
 * rectangle. Private to this module to keep `src/physics/` free of imports
 * from `src/rendering/`. Mirrors the rendering-layer helper of the same name
 * exactly — duplicated here because the rendering version's WorldBounds type
 * lives in the rendering layer.
 */
function maxCornerDist(pt: Vec2, bounds: SamplerBounds): number {
  const { minX, maxX, minY, maxY } = bounds;
  let best = 0;
  for (const cx of [minX, maxX]) {
    for (const cy of [minY, maxY]) {
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > best) best = d;
    }
  }
  return best;
}

/**
 * Record one stop-aware tick across every charge's history.
 *
 * For each charge:
 *  1. Records substep states inside the braking overlap. brakingSubstepTimes
 *     returns the boundary anchors at T_trig and brakeEnd (when the frame
 *     straddles them) plus interior substeps spaced no further apart than
 *     SUDDEN_STOP_BRAKE_SUBSTEP_DT. Outside the brake window (purely pre-trigger
 *     or purely post-stop frames) it returns [], so no substeps are recorded.
 *  2. Records the current state at currentSimTime.
 *  3. Updates the per-charge history window from the stopped current position.
 *     Uses maxHistorySpeed(mode) — the pre-stop peak speed — as the horizon-
 *     speed budget so outside-shell observers retain enough pre-trigger
 *     history to "see" the charge at its old uniform-motion position.
 *
 * Pre: mode is stoppable. The caller (the simulation tick) must check this.
 */
export function recordStoppedFrame(
  runtimes: ChargeRuntime[],
  mode: StoppableMode,
  prevSimTime: number,
  currentSimTime: number,
  T_trig: number,
  viewBounds: SamplerBounds,
  config: SimConfig,
): void {
  const horizonSpeed = maxHistorySpeed(mode);
  const substepTimes = brakingSubstepTimes(prevSimTime, currentSimTime, T_trig);

  // Iterate substep-first so we evaluate sampleStoppedDemoChargeStates once
  // per substep and read all charges from the resulting array. Iterating
  // charge-first would require N×M dispatch evaluations for N charges and
  // M substeps; this gives O(M + 1) dispatch evaluations.
  for (const tSub of substepTimes) {
    const specs = sampleStoppedDemoChargeStates(mode, tSub, T_trig);
    for (let ci = 0; ci < runtimes.length; ci++) {
      const state: KinematicState = specs[ci].state;
      runtimes[ci].history.recordState(state);
    }
  }

  // Current sample plus per-charge window/prune.
  const currentSpecs = sampleStoppedDemoChargeStates(mode, currentSimTime, T_trig);
  for (let ci = 0; ci < runtimes.length; ci++) {
    const state = currentSpecs[ci].state;
    runtimes[ci].history.recordState(state);
    runtimes[ci].history.setMaxHistoryTime(
      maxCornerDist(state.pos, viewBounds) / (config.c - horizonSpeed),
    );
    runtimes[ci].history.pruneToWindow(currentSimTime);
  }
}

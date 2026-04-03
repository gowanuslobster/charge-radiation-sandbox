// ChargeHistory — single source of truth for a charge's kinematic past.
//
// Responsibilities: storage, interpolation, and pruning only.
// The retarded-time solver lives in retardedTime.ts, not here.
//
// States must be recorded in monotonically increasing time order.
// Out-of-order insertion is not supported and will produce incorrect interpolation.

import type { KinematicState, Vec2 } from './types';
import { add, scale } from './vec2';

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return add(scale(a, 1 - t), scale(b, t));
}

function lerpState(a: KinematicState, b: KinematicState, t: number): KinematicState {
  return {
    t: a.t + t * (b.t - a.t),
    pos: lerpVec2(a.pos, b.pos, t),
    vel: lerpVec2(a.vel, b.vel, t),
    accel: lerpVec2(a.accel, b.accel, t),
  };
}

export class ChargeHistory {
  private states: KinematicState[] = [];
  // Maximum history window in seconds. Set via setMaxHistoryTime.
  // 0 means no automatic pruning policy is active.
  private maxHistoryTime: number = 0;

  /** Append a new kinematic state. Must be called with monotonically increasing t. */
  recordState(state: KinematicState): void {
    this.states.push(state);
  }

  /**
   * Linear interpolation of the charge state at any target time.
   *
   * - If targetTime is before the oldest recorded state, clamps to oldest (no extrapolation).
   * - If targetTime is after the newest recorded state, clamps to newest.
   * - Otherwise, binary-searches for the surrounding bracket and linearly interpolates.
   *
   * Clamping (not null) is the correct physics fallback for interpolation: the charge
   * had some definite state; we just don't have a more precise record of it.
   *
   * Precondition: history is not empty. Call isEmpty() before invoking this.
   */
  interpolateAt(targetTime: number): KinematicState {
    const states = this.states;
    // Clamp below
    if (targetTime <= states[0].t) return states[0];
    // Clamp above
    const last = states[states.length - 1];
    if (targetTime >= last.t) return last;

    // Binary search for the first index whose time exceeds targetTime.
    let lo = 0;
    let hi = states.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (states[mid].t <= targetTime) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    // states[lo].t <= targetTime < states[hi].t
    const a = states[lo];
    const b = states[hi];
    const t = (targetTime - a.t) / (b.t - a.t);
    return lerpState(a, b, t);
  }

  /**
   * Remove all states with t < cutoffTime.
   * Used by callers who manage their own cutoff calculation.
   */
  pruneBefore(cutoffTime: number): void {
    // Find the index of the first state to keep (t >= cutoffTime).
    // We keep at least one state (the oldest useful one) so interpolation has a floor.
    let keepFrom = 0;
    for (let i = 0; i < this.states.length; i++) {
      if (this.states[i].t >= cutoffTime) {
        // Keep one entry before the cutoff to serve as the interpolation floor.
        keepFrom = Math.max(0, i - 1);
        break;
      }
      keepFrom = i + 1;
    }
    if (keepFrom > 0) {
      this.states = this.states.slice(keepFrom);
    }
  }

  /**
   * Set the maximum history window.
   * Call this whenever c or the visible viewport radius changes.
   * The window should be at least (worldRadius / c) seconds.
   */
  setMaxHistoryTime(maxHistorySeconds: number): void {
    this.maxHistoryTime = maxHistorySeconds;
  }

  /**
   * Prune states older than (currentTime - maxHistoryTime).
   * No-op if maxHistoryTime has not been set (is 0).
   * The caller is responsible for driving this; ChargeHistory does not auto-prune.
   */
  pruneToWindow(currentTime: number): void {
    if (this.maxHistoryTime <= 0) return;
    this.pruneBefore(currentTime - this.maxHistoryTime);
  }

  isEmpty(): boolean {
    return this.states.length === 0;
  }

  /** Returns the oldest state, or null if history is empty. */
  oldest(): KinematicState | null {
    if (this.isEmpty()) return null;
    return this.states[0];
  }

  /** Returns the newest state, or null if history is empty. */
  newest(): KinematicState | null {
    if (this.isEmpty()) return null;
    return this.states[this.states.length - 1];
  }
}

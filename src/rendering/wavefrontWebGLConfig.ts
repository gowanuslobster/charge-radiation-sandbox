// Configuration constants for the WebGL heatmap renderer (WavefrontWebGLCanvas).
//
// Extracted here so non-component code (e.g. ChargeRadiationSandbox) can import
// minCForMode without triggering react-refresh's "only-export-components" rule.

// ── c-slider minimum (Policy A — conservative global minimum) ────────────────
//
// Derived from: c_min = v_peak + maxCornerDist / (MAX_HISTORY_SAMPLES * dt)
//
// Assumptions:
//   maxCornerDist = 8.1  (sqrt(7² + 4²) ≈ 8.06 for default view [-7,7]×[-4,4])
//   dt            = 1/60 (60fps — typical recording cadence)
//   MAX_HISTORY_SAMPLES = 4096
//   v_peak(moving_charge) = SUDDEN_STOP_V = 0.6
//   v_peak(oscillating)   = OSCILLATING_AMPLITUDE × OSCILLATING_OMEGA = 0.5
//
// c_min = v_peak + 8.1 × 60 / 4096  =  v_peak + 0.119
//
// Rounded up slightly for safety margin:
const CMIN_MOVING_CHARGE = 0.72;   // 0.6 + 0.119 ≈ 0.72
const CMIN_OSCILLATING   = 0.62;   // 0.5 + 0.119 ≈ 0.62

// Dipole shares oscillating's peak speed (same A·ω = 0.5), so same c minimum.
export function minCForMode(mode: 'moving_charge' | 'oscillating' | 'dipole'): number {
  return mode === 'moving_charge' ? CMIN_MOVING_CHARGE : CMIN_OSCILLATING;
}

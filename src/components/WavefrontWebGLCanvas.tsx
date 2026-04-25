// WavefrontWebGLCanvas — WebGL2 fragment-shader heatmap for the magnetic-field overlay.
//
// Drop-in replacement for WavefrontOverlayCanvas (same prop interface).
// Evaluates the Liénard-Wiechert magnetic field (bZ, bZVel, bZAccel) at every
// screen pixel via a GLSL fragment shader that replicates the full retarded-time
// solve. The channel rendered as a signed warm/cool heatmap is chosen by the
// `heatmapChannel` prop; the wavefront contour, when enabled, always reads the
// radiative (bZAccel) sum regardless of that choice.
//
// History is uploaded each frame as a 2D RGBA32F texture (TEX_WIDTH × TEX_HEIGHT).
// Supports up to MAX_CHARGES independent charge histories. Each charge occupies a
// contiguous texel slice; the shader solves retarded time independently per charge
// and sums the three magnetic components.
//
// Normalization is mode-aware and per-channel (see "Normalization" block below).

import { useEffect, useRef, type CSSProperties, type RefObject, type MutableRefObject } from 'react';
import type { SimConfig } from '@/physics/types';
import type { ChargeRuntime } from '@/physics/chargeRuntime';
import {
  type DemoMode,
  type MagneticHeatmapMode,
  DIPOLE_OMEGA,
  HYDROGEN_OMEGA,
  OSCILLATING_OMEGA,
} from '@/physics/demoModes';
import type { WorldBounds } from '@/rendering/worldSpace';
import { createSamplerState, sampleWavefront } from '@/physics/wavefrontSampler';
import { computeContrastPeak } from '@/rendering/wavefrontRender';
import {
  createShaderProgram,
  createFloat32Texture,
  createFullscreenQuad,
} from '@/rendering/webglUtils';

// ── History texture layout ─────────────────────────────────────────────────────
//
// Supports up to MAX_CHARGES independent charge histories.
// Each charge occupies a contiguous block of CHARGE_TEXEL_STRIDE = 2×MAX_HISTORY_SAMPLES
// texels. Charge k starts at absolute texel k × CHARGE_TEXEL_STRIDE.
//
// Within each block, state i occupies texels 2i and 2i+1:
//   texel 2i+0: (t_offset, pos.x, pos.y, vel.x)
//   texel 2i+1: (vel.y, accel.x, accel.y, 0.0)  ← padding channel
//
// t_offset = state.t − tCurrent, computed in float64 then cast to float32.
//
// 2D addressing: absolute texel index t → ivec2(t % TEX_WIDTH, t / TEX_WIDTH)
//
//   MAX_CHARGES           = 2
//   MAX_HISTORY_SAMPLES   = 4096
//   CHARGE_TEXEL_STRIDE   = 2 × 4096 = 8192
//   Total texels          = 2 × 8192 = 16384
//   TEX_WIDTH × TEX_HEIGHT = 512 × 32 = 16384  ✓ (both ≤ WebGL2 min MAX_TEXTURE_SIZE 2048)
//
// Charge 0: absolute texels 0–8191       → rows  0–15 of the 512-wide texture
// Charge 1: absolute texels 8192–16383   → rows 16–31 of the 512-wide texture

const MAX_CHARGES         = 2;
const MAX_HISTORY_SAMPLES = 4096;
const TEX_WIDTH           = 512;
// Derived: (2 × MAX_CHARGES × MAX_HISTORY_SAMPLES) / TEX_WIDTH = 16384 / 512 = 32
const TEX_HEIGHT          = (2 * MAX_CHARGES * MAX_HISTORY_SAMPLES) / TEX_WIDTH;  // 32

// Fixed iteration counts for GPU loops.
const BINARY_SEARCH_ITERS = 12;   // ceil(log2(4096))
const NEWTON_ITERS        = 28;   // profiling target range 24–32

// Normalization probe parameters.
const NORM_PROBE_W   = 32;
const NORM_PROBE_H   = 32;
const NORM_EMA_ALPHA = 0.12;               // temporal smoothing for Policy A modes
const PERIODIC_NORM_PHASE_SAMPLES = 8;     // Policy B phase sweep count

// Channel indices (match shader's u_bzChannel uniform).
const CHANNEL_TOTAL = 0;
const CHANNEL_VEL   = 1;
const CHANNEL_ACCEL = 2;

// Phase I performance cap: limit the effective DPR for this canvas only.
const WEBGL_MAX_DPR = 1.5;

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  chargeRuntimesRef: RefObject<ChargeRuntime[]>;
  simulationTimeRef: MutableRefObject<number>;
  configRef:         MutableRefObject<SimConfig>;
  simEpochRef:       MutableRefObject<number>;
  bounds:            WorldBounds;
  demoMode:          DemoMode;
  heatmapChannel:    MagneticHeatmapMode;
  showContours:      boolean;
  isPausedRef:       MutableRefObject<boolean>;
  style?:            CSSProperties;
};

// ── Vertex shader ─────────────────────────────────────────────────────────────

const VERT_SRC = /* glsl */`#version 300 es
layout(location = 0) in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ── Fragment shader ───────────────────────────────────────────────────────────
//
// Per-charge solver structure (all key functions take chargeIdx):
//   fetchState(chargeIdx, i)                 — read 2 texels from the charge's slice
//   interpState(a, b, frac)                  — linear interpolation between states
//   historyLookup(chargeIdx, t, histCount)   — binary search + interpolation
//   solveRetarded(chargeIdx, r_obs, histCount) — bracketed Newton solver
//   computeBZComponents(r_obs, ret, chargeVal) — Liénard-Wiechert (total, vel, accel)
//   main()                                   — loops over charges, sums per channel

const FRAG_SRC = /* glsl */`#version 300 es
precision highp float;
precision highp int;

// ── Constants (injected from JS to stay in sync) ──────────────────────────────
//
// CHARGE_TEXEL_STRIDE = 2 × MAX_HISTORY_SAMPLES
// Charge k's texel block starts at absolute texel k × CHARGE_TEXEL_STRIDE.
const int MAX_CHARGES         = ${MAX_CHARGES};
const int CHARGE_TEXEL_STRIDE = ${2 * MAX_HISTORY_SAMPLES};

// ── Uniforms ──────────────────────────────────────────────────────────────────
uniform sampler2D u_history;            // RGBA32F, TEX_WIDTH × TEX_HEIGHT
uniform int       u_texWidth;           // TEX_WIDTH constant (for 2D addressing)
uniform int       u_chargeCount;        // number of active charges (1 or 2)
uniform int       u_historyCounts[2];   // per-charge valid state count
uniform float     u_charges[2];         // per-charge signed charge value
uniform float     u_c;
uniform vec4      u_worldBounds;        // (minX, maxX, minY, maxY) in world space
uniform vec2      u_resolution;         // canvas physical pixel size (post-DPR)
uniform bool      u_isSigned;           // true = zero-crossing contour (oscillating, dipole, hydrogen)
                                        // false = envelope contour (moving_charge)
uniform float     u_heatmapPeak;        // normalization ceiling for the selected heatmap channel
uniform float     u_accelPeak;          // normalization ceiling for the bZAccel contour branch
uniform int       u_bzChannel;          // 0 = total, 1 = vel, 2 = accel
uniform bool      u_showHeatmap;
uniform bool      u_showContour;
uniform float     u_softening;
uniform bool      u_debugMode;          // dev-only: output raw bZAccel sum to fragColor.r

out vec4 fragColor;

// ── KinematicState struct ─────────────────────────────────────────────────────

struct KinematicState {
  float t;
  vec2  pos;
  vec2  vel;
  vec2  accel;
};

struct BZComponents {
  float total;
  float vel;
  float accel;
};

// ── History texture fetch ─────────────────────────────────────────────────────
//
// Each charge occupies a contiguous block starting at texel chargeIdx × CHARGE_TEXEL_STRIDE.
// State i within that block occupies texels (base+2i) and (base+2i+1).

KinematicState fetchState(int chargeIdx, int i) {
  int base = chargeIdx * CHARGE_TEXEL_STRIDE;
  int t0   = base + 2 * i;
  int t1   = base + 2 * i + 1;
  ivec2 c0 = ivec2(t0 % u_texWidth, t0 / u_texWidth);
  ivec2 c1 = ivec2(t1 % u_texWidth, t1 / u_texWidth);
  vec4 a = texelFetch(u_history, c0, 0);  // (t_offset, pos.x, pos.y, vel.x)
  vec4 b = texelFetch(u_history, c1, 0);  // (vel.y, accel.x, accel.y, _)
  KinematicState s;
  s.t     = a.x;
  s.pos   = vec2(a.y, a.z);
  s.vel   = vec2(a.w, b.x);
  s.accel = vec2(b.y, b.z);
  return s;
}

KinematicState interpState(KinematicState a, KinematicState b, float frac) {
  KinematicState s;
  s.t     = a.t     + frac * (b.t     - a.t);
  s.pos   = a.pos   + frac * (b.pos   - a.pos);
  s.vel   = a.vel   + frac * (b.vel   - a.vel);
  s.accel = a.accel + frac * (b.accel - a.accel);
  return s;
}

// Fixed-count binary search over one charge's history texture slice.
// Returns the interpolated state at t_query, or clamps to the slice endpoints.
KinematicState historyLookup(int chargeIdx, float t_query, int historyCount) {
  if (historyCount <= 0) {
    KinematicState zero;
    zero.t = 0.0; zero.pos = vec2(0.0); zero.vel = vec2(0.0); zero.accel = vec2(0.0);
    return zero;
  }
  KinematicState oldest = fetchState(chargeIdx, 0);
  KinematicState newest = fetchState(chargeIdx, historyCount - 1);
  if (t_query <= oldest.t) return oldest;
  if (t_query >= newest.t) return newest;

  int lo = 0;
  int hi = historyCount - 1;
  for (int iter = 0; iter < ${BINARY_SEARCH_ITERS}; iter++) {
    int mid = (lo + hi) / 2;
    KinematicState s = fetchState(chargeIdx, mid);
    if (s.t <= t_query) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo <= 1) break;
  }
  KinematicState s0 = fetchState(chargeIdx, lo);
  KinematicState s1 = fetchState(chargeIdx, hi);
  float span = s1.t - s0.t;
  float frac = (span > 0.0) ? (t_query - s0.t) / span : 0.0;
  return interpState(s0, s1, frac);
}

// ── Bracketed Newton retarded-time solver ─────────────────────────────────────
//
// Residual: f(t) = -t - |r_obs - r(t)| / c   (t_obs = 0.0 after timestamp offset)
//
// Invariant: f(t_lo) > 0 and f(t_hi) ≤ 0, guaranteed by causality.
// Enforced by the c-slider minimum in ChargeRadiationSandbox — must hold for all
// visible pixels.

KinematicState solveRetarded(int chargeIdx, vec2 r_obs, int historyCount) {
  if (historyCount <= 1) {
    return historyLookup(chargeIdx, 0.0, historyCount);
  }

  KinematicState oldest = fetchState(chargeIdx, 0);
  KinematicState newest = fetchState(chargeIdx, historyCount - 1);

  float t_lo = oldest.t;   // < 0 (offset-relative)
  float t_hi = 0.0;        // t_obs (= "now" in offset coordinates)

  float R_lo = length(r_obs - oldest.pos);
  float f_lo = -t_lo - R_lo / u_c;         // > 0 by causality assumption
  float R_hi = length(r_obs - newest.pos);
  float f_hi = -0.0 - R_hi / u_c;          // ≤ 0

  float t_ret = -length(r_obs - newest.pos) / u_c;
  t_ret = clamp(t_ret, t_lo, t_hi);

  for (int iter = 0; iter < ${NEWTON_ITERS}; iter++) {
    KinematicState s = historyLookup(chargeIdx, t_ret, historyCount);
    vec2  R_vec = r_obs - s.pos;
    float R     = max(length(R_vec), 1e-10);
    float f     = -t_ret - R / u_c;
    float df    = -1.0 + dot(R_vec, s.vel) / (R * u_c);

    // Shrink bracket before choosing next iterate.
    if (f > 0.0) { t_lo = t_ret; f_lo = f; }
    else         { t_hi = t_ret; f_hi = f; }

    float candidate = (abs(df) > 1e-10) ? (t_ret - f / df) : t_ret;
    t_ret = (candidate > t_lo && candidate < t_hi) ? candidate : (t_lo + t_hi) * 0.5;
  }

  return historyLookup(chargeIdx, t_ret, historyCount);
}

// ── Liénard-Wiechert magnetic-field components for one charge ─────────────────
//
// bZVel   (bound)       = -q · cross2D(n̂, β) / (γ² κ³ R_eff² c)
// bZAccel (radiative)   = -q · cross2D(n̂−β, β̇) / (c² κ³ R_eff)
// bZ                    = bZVel + bZAccel
//
// Matches evaluateLWFieldFromState in src/physics/lienardWiechert.ts term-by-term,
// after the 2D simplification |n̂|² = 1 that collapses n̂ × ((n̂−β) × β̇) to a scalar.

BZComponents computeBZComponents(vec2 r_obs, KinematicState ret, float chargeVal) {
  vec2  R_vec   = r_obs - ret.pos;
  float R_eff   = sqrt(dot(R_vec, R_vec) + u_softening * u_softening);
  vec2  nHat    = R_vec / R_eff;
  vec2  beta    = ret.vel   / u_c;
  vec2  betaDot = ret.accel / u_c;

  float kappa   = 1.0 - dot(nHat, beta);
  float kappa3  = max(kappa, 1e-6);
  kappa3        = kappa3 * kappa3 * kappa3;

  float betaSq  = min(dot(beta, beta), 1.0 - 1e-6);
  float gammaSq = 1.0 / (1.0 - betaSq);

  float crossNB  = nHat.x * beta.y    - nHat.y * beta.x;
  vec2  nBeta    = nHat - beta;
  float crossNBD = nBeta.x * betaDot.y - nBeta.y * betaDot.x;

  float bZVel   = -chargeVal * crossNB  / (gammaSq * kappa3 * R_eff * R_eff * u_c);
  float bZAccel = -chargeVal * crossNBD / (u_c * u_c * kappa3 * R_eff);

  BZComponents b;
  b.vel   = bZVel;
  b.accel = bZAccel;
  b.total = bZVel + bZAccel;
  return b;
}

// ── Color mapping (must match wavefrontRender.ts) ─────────────────────────────

const vec3 WARM = vec3(1.0, 0.549, 0.118);   // (255,140,30)/255
const vec3 COOL = vec3(0.314, 0.392, 1.0);   // (80,100,255)/255

vec4 signedColor(float bZ, float peak) {
  float norm     = bZ / peak;
  float shaped   = tanh(norm * 1.4);
  float strength = pow(abs(shaped), 0.82);
  vec3 rgb = (shaped >= 0.0) ? WARM : COOL;
  return vec4(rgb * strength, strength);
}

// ── Main ──────────────────────────────────────────────────────────────────────

void main() {
  if (u_chargeCount <= 0) { discard; return; }
  if (!u_debugMode && !u_showHeatmap && !u_showContour) { discard; return; }

  // Convert gl_FragCoord to world space.
  // WebGL: gl_FragCoord.y = 0 at bottom, matching world-space +Y-up convention.
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float worldX = u_worldBounds.x + uv.x * (u_worldBounds.y - u_worldBounds.x);
  float worldY = u_worldBounds.z + uv.y * (u_worldBounds.w - u_worldBounds.z);
  vec2 worldPos = vec2(worldX, worldY);

  // Sum the three Bz components across all active charges.
  // Each charge has its own retarded-time solve — no cross-charge coupling.
  float sumTotal = 0.0;
  float sumVel   = 0.0;
  float sumAccel = 0.0;
  for (int ci = 0; ci < MAX_CHARGES; ci++) {
    if (ci >= u_chargeCount) break;
    int hcount = u_historyCounts[ci];
    if (hcount <= 0) continue;
    KinematicState retState = solveRetarded(ci, worldPos, hcount);
    BZComponents comp = computeBZComponents(worldPos, retState, u_charges[ci]);
    sumTotal += comp.total;
    sumVel   += comp.vel;
    sumAccel += comp.accel;
  }

  // Dev-only: bypass color mapping and output raw summed bZAccel for validation.
  if (u_debugMode) {
    fragColor = vec4(sumAccel, 0.0, 0.0, 1.0);
    return;
  }

  float heatmapScalar = (u_bzChannel == 0) ? sumTotal
                      : (u_bzChannel == 1) ? sumVel
                                           : sumAccel;

  vec4 outColor = vec4(0.0);

  if (u_showHeatmap) {
    outColor = signedColor(heatmapScalar, u_heatmapPeak);
  }

  // Wavefront contour is a radiation annotation: always reads the bZAccel sum
  // regardless of which channel the heatmap is displaying.
  if (u_showContour) {
    if (u_isSigned) {
      // oscillating, dipole, and hydrogen: zero-crossing contour on summed bZAccel
      float norm         = sumAccel / u_accelPeak;
      float contourWidth = fwidth(norm) * 1.5;
      float contourMask  = 1.0 - smoothstep(0.0, contourWidth, abs(norm));
      vec4 contourColor  = vec4(0.88, 0.88, 0.88, 0.85);
      outColor = mix(outColor, contourColor, contourMask);
    } else {
      // moving_charge: envelope threshold contour (marks radiation shell boundary)
      const float CONTOUR_FRAC = 0.03;
      float norm         = abs(sumAccel) / u_accelPeak;
      float contourWidth = fwidth(norm) * 2.0;
      float dist         = abs(norm - CONTOUR_FRAC);
      float contourMask  = 1.0 - smoothstep(0.0, contourWidth, dist);
      vec4 contourColor  = vec4(0.88, 0.88, 0.88, 0.85);
      outColor = mix(outColor, contourColor, contourMask);
    }
  }

  if (outColor.a < 0.01) { discard; return; }
  fragColor = outColor;
}
`;

// ── Mode period lookup (Policy B) ─────────────────────────────────────────────

function periodicModePeriod(mode: DemoMode): number | null {
  if (mode === 'oscillating') return (2 * Math.PI) / OSCILLATING_OMEGA;
  if (mode === 'dipole')      return (2 * Math.PI) / DIPOLE_OMEGA;
  if (mode === 'hydrogen')    return (2 * Math.PI) / HYDROGEN_OMEGA;
  return null;
}

function channelIndex(channel: MagneticHeatmapMode): number {
  if (channel === 'total') return CHANNEL_TOTAL;
  if (channel === 'vel')   return CHANNEL_VEL;
  if (channel === 'accel') return CHANNEL_ACCEL;
  return -1; // 'off'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WavefrontWebGLCanvas({
  chargeRuntimesRef,
  simulationTimeRef,
  configRef,
  simEpochRef,
  bounds,
  demoMode,
  heatmapChannel,
  showContours,
  isPausedRef,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Stable refs to the latest prop values — read each RAF tick without re-mounting.
  const boundsRef         = useRef(bounds);
  const heatmapChannelRef = useRef(heatmapChannel);
  const showContoursRef   = useRef(showContours);
  const demoModeRef       = useRef(demoMode);
  boundsRef.current         = bounds;
  heatmapChannelRef.current = heatmapChannel;
  showContoursRef.current   = showContours;
  demoModeRef.current       = demoMode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false });
    if (!gl) return;   // fallback handled by parent; should not reach here

    // ── GL setup ──────────────────────────────────────────────────────────────
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let program: WebGLProgram;
    let uniforms: Record<string, WebGLUniformLocation>;
    let historyTex: WebGLTexture;
    let vao: WebGLVertexArrayObject;
    let vbo: WebGLBuffer;

    try {
      ({ program, uniforms } = createShaderProgram(gl, VERT_SRC, FRAG_SRC));
      historyTex = createFloat32Texture(gl, TEX_WIDTH, TEX_HEIGHT);
      ({ vao, vbo } = createFullscreenQuad(gl));
    } catch (e) {
      console.error('[WavefrontWebGLCanvas] GL init failed:', e);
      return;
    }

    // Pre-allocated staging buffer: all charge histories packed contiguously.
    const staging = new Float32Array(TEX_WIDTH * TEX_HEIGHT * 4);

    // Pre-allocated uniform arrays (avoid allocations in the tick hot path).
    const histCountsArr = new Int32Array(MAX_CHARGES);
    const chargeValsArr = new Float32Array(MAX_CHARGES);

    // Normalization probes — one sampler state per charge slot; length tied to MAX_CHARGES.
    const normSamplerStates = Array.from({ length: MAX_CHARGES }, createSamplerState);
    // Per-channel scratch buffers for summing multi-charge probe contributions.
    const probeScratch = [
      new Float32Array(NORM_PROBE_W * NORM_PROBE_H), // total
      new Float32Array(NORM_PROBE_W * NORM_PROBE_H), // vel
      new Float32Array(NORM_PROBE_W * NORM_PROBE_H), // accel
    ];

    // ── Normalization state ───────────────────────────────────────────────────
    //
    // Two policies, each with per-channel storage (index 0=total, 1=vel, 2=accel):
    //
    //   Policy A (transient modes: moving_charge, draggable) — dynamic EMA.
    //     smoothedPeaks[k] = α · rawPeak + (1-α) · smoothedPeaks[k], per channel.
    //     Hard reset bypasses the EMA for one frame.
    //
    //   Policy B (periodic modes: oscillating, dipole, hydrogen) — phase-invariant
    //     cache. Sweep PERIODIC_NORM_PHASE_SAMPLES probe times over one period,
    //     take per-channel max, cache until invalidated.
    //
    // Invalidation (both policies): epoch / mode / c / charges / bounds / channel.
    const smoothedPeaks = new Float64Array(3);  // Policy A
    const cachedPeaks   = new Float64Array(3);  // Policy B
    let   cachedPeaksValid = false;

    let prevNormEpoch      = NaN;
    let prevNormMode       = '' as DemoMode;
    let prevNormC          = NaN;
    let prevNormChargeCount = -1;
    const prevNormChargeVals = new Float64Array(MAX_CHARGES).fill(NaN);
    let prevNormBounds     = { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN } as typeof bounds;

    // ── RAF loop ──────────────────────────────────────────────────────────────
    let rafId    = 0;
    let glAlive  = true;

    const tick = () => {
      if (!glAlive) return;

      const runtimes   = chargeRuntimesRef.current;
      const tCurrent   = simulationTimeRef.current;
      const config     = configRef.current;
      const epoch      = simEpochRef.current;
      const mode       = demoModeRef.current;
      const curBounds  = boundsRef.current;
      const channel    = heatmapChannelRef.current;
      const doContour  = showContoursRef.current;
      const doHeatmap  = channel !== 'off';
      const paused     = isPausedRef.current;

      if (!doHeatmap && !doContour) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        rafId = requestAnimationFrame(tick);
        return;
      }

      // ── Pack history into staging buffer ────────────────────────────────────
      //
      // Each charge's states are packed into a contiguous slice of TEX_WIDTH × TEX_HEIGHT.
      // Charge k's texel block starts at absolute texel k × CHARGE_TEXEL_STRIDE.
      // staging.fill(0) clears all slots so stale data beyond histCount is harmless.
      // Clamp to the texture capacity. If more runtimes arrive (e.g. a future 3-charge
      // demo), the excess charges are silently dropped and the heatmap will be wrong.
      // The dev warning below surfaces this immediately so the routing in
      // ChargeRadiationSandbox can be updated to use the CPU fallback instead.
      if (import.meta.env.DEV && runtimes.length > MAX_CHARGES) {
        console.warn(
          `[WavefrontWebGLCanvas] ${runtimes.length} charge runtimes supplied but shader ` +
          `only supports MAX_CHARGES=${MAX_CHARGES}. Excess charges are ignored. ` +
          `Route to WavefrontOverlayCanvas for scenes with more than ${MAX_CHARGES} charges.`,
        );
      }
      const chargeCount = Math.min(runtimes.length, MAX_CHARGES);
      staging.fill(0);
      histCountsArr.fill(0);
      chargeValsArr.fill(0);

      for (let ci = 0; ci < chargeCount; ci++) {
        const { history, charge } = runtimes[ci];
        const hcount = (!history || history.isEmpty()) ? 0 : history.count;
        histCountsArr[ci] = hcount;
        chargeValsArr[ci] = charge;

        if (hcount === 0 || !history) continue;

        // Charge k's slice starts at absolute texel k × CHARGE_TEXEL_STRIDE.
        const texelBase = ci * 2 * MAX_HISTORY_SAMPLES;
        for (let i = 0; i < hcount; i++) {
          const s   = history.stateAt(i);
          const tOff = s.t - tCurrent;  // float64 precision before cast to float32
          const t0  = texelBase + 2 * i;
          const t1  = texelBase + 2 * i + 1;
          staging[t0 * 4 + 0] = tOff;
          staging[t0 * 4 + 1] = s.pos.x;
          staging[t0 * 4 + 2] = s.pos.y;
          staging[t0 * 4 + 3] = s.vel.x;
          staging[t1 * 4 + 0] = s.vel.y;
          staging[t1 * 4 + 1] = s.accel.x;
          staging[t1 * 4 + 2] = s.accel.y;
          staging[t1 * 4 + 3] = 0.0;
        }
      }

      // ── Upload history texture ──────────────────────────────────────────────
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, TEX_WIDTH, TEX_HEIGHT,
        gl.RGBA, gl.FLOAT, staging,
      );

      // ── Mode-aware per-channel normalization ────────────────────────────────
      //
      // Invalidation conditions (shared by both policies):
      const epochChanged   = epoch   !== prevNormEpoch;
      const modeChanged    = mode    !== prevNormMode;
      const cChanged       = config.c !== prevNormC;
      let   chargesChanged = chargeCount !== prevNormChargeCount;
      if (!chargesChanged) {
        for (let ci = 0; ci < chargeCount; ci++) {
          if (runtimes[ci].charge !== prevNormChargeVals[ci]) { chargesChanged = true; break; }
        }
      }
      const boundsChanged =
        curBounds.minX !== prevNormBounds.minX ||
        curBounds.maxX !== prevNormBounds.maxX ||
        curBounds.minY !== prevNormBounds.minY ||
        curBounds.maxY !== prevNormBounds.maxY;

      // NOTE: channel switches deliberately do NOT invalidate the cached peaks.
      // Both Policy B's cache and Policy A's EMA store all three channel slots,
      // populated together on every probe. Flipping the heatmap channel just
      // selects a different slot; no recompute is needed.
      const hardReset     = epochChanged || modeChanged || cChanged || chargesChanged;
      const invalidate    = hardReset || boundsChanged;
      const period        = periodicModePeriod(mode);
      const policyB       = period !== null;

      // Run the probe at probeTime and accumulate per-channel peaks into `peaksOut`
      // using Math.max semantics. Returns the three raw single-phase peaks as well.
      const runProbe = (probeTime: number): [number, number, number] => {
        probeScratch[CHANNEL_TOTAL].fill(0);
        probeScratch[CHANNEL_VEL].fill(0);
        probeScratch[CHANNEL_ACCEL].fill(0);
        for (let ci = 0; ci < chargeCount; ci++) {
          const { history: h, charge: q } = runtimes[ci];
          if (!h || h.isEmpty()) continue;
          const samples = sampleWavefront(normSamplerStates[ci], {
            history: h,
            simTime:  probeTime,
            charge:   q,
            config,
            bounds:   curBounds,
            gridW:    NORM_PROBE_W,
            gridH:    NORM_PROBE_H,
            simEpoch: epoch,
          });
          const total = probeScratch[CHANNEL_TOTAL];
          const vel   = probeScratch[CHANNEL_VEL];
          const accel = probeScratch[CHANNEL_ACCEL];
          for (let k = 0; k < total.length; k++) {
            total[k] += samples.bZ[k];
            vel[k]   += samples.bZVel[k];
            accel[k] += samples.bZAccel[k];
          }
        }
        return [
          computeContrastPeak(probeScratch[CHANNEL_TOTAL], 'signed'),
          computeContrastPeak(probeScratch[CHANNEL_VEL],   'signed'),
          computeContrastPeak(probeScratch[CHANNEL_ACCEL], 'signed'),
        ];
      };

      if (policyB) {
        // Policy B: phase-invariant cache. Recompute only on invalidation; otherwise
        // the cached per-channel peaks are canonical.
        if (invalidate) cachedPeaksValid = false;
        if (!cachedPeaksValid) {
          const T = period as number;
          const N = PERIODIC_NORM_PHASE_SAMPLES;
          let maxT = 0, maxV = 0, maxA = 0;
          for (let si = 0; si < N; si++) {
            const probeTime = tCurrent - (si * T) / N;
            const [pt, pv, pa] = runProbe(probeTime);
            if (pt > maxT) maxT = pt;
            if (pv > maxV) maxV = pv;
            if (pa > maxA) maxA = pa;
          }
          cachedPeaks[CHANNEL_TOTAL] = maxT;
          cachedPeaks[CHANNEL_VEL]   = maxV;
          cachedPeaks[CHANNEL_ACCEL] = maxA;
          cachedPeaksValid = true;
        }
      } else {
        // Policy A: dynamic EMA. Re-probe on every unpaused frame (or after an
        // invalidation) so the peak tracks transient dynamics.
        if (hardReset) { smoothedPeaks[0] = 0; smoothedPeaks[1] = 0; smoothedPeaks[2] = 0; }
        const needsProbe = hardReset || !paused || boundsChanged;
        if (needsProbe) {
          const [rt, rv, ra] = runProbe(tCurrent);
          const raw: [number, number, number] = [rt, rv, ra];
          for (let k = 0; k < 3; k++) {
            if (hardReset || smoothedPeaks[k] === 0) {
              smoothedPeaks[k] = raw[k];
            } else {
              smoothedPeaks[k] = NORM_EMA_ALPHA * raw[k] + (1 - NORM_EMA_ALPHA) * smoothedPeaks[k];
            }
          }
        }
        // else: reuse last smoothedPeaks values (paused-frame short-circuit).
      }

      prevNormEpoch  = epoch;
      prevNormMode   = mode;
      prevNormC      = config.c;
      prevNormChargeCount = chargeCount;
      for (let ci = 0; ci < chargeCount; ci++) prevNormChargeVals[ci] = runtimes[ci].charge;
      for (let ci = chargeCount; ci < MAX_CHARGES; ci++) prevNormChargeVals[ci] = NaN;
      prevNormBounds = { ...curBounds };

      const activePeaks = policyB ? cachedPeaks : smoothedPeaks;
      const chIdx = channelIndex(channel);
      const heatmapPeak = Math.max(chIdx >= 0 ? activePeaks[chIdx] : 0, 1e-10);
      const accelPeak   = Math.max(activePeaks[CHANNEL_ACCEL], 1e-10);
      const bzChannelUniform = chIdx >= 0 ? chIdx : CHANNEL_ACCEL; // harmless default

      // ── Set uniforms ────────────────────────────────────────────────────────
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      if (uniforms['u_history']       !== undefined) gl.uniform1i(uniforms['u_history'], 0);
      if (uniforms['u_texWidth']      !== undefined) gl.uniform1i(uniforms['u_texWidth'], TEX_WIDTH);
      if (uniforms['u_chargeCount']   !== undefined) gl.uniform1i(uniforms['u_chargeCount'], chargeCount);
      if (uniforms['u_historyCounts'] !== undefined) gl.uniform1iv(uniforms['u_historyCounts'], histCountsArr);
      if (uniforms['u_charges']       !== undefined) gl.uniform1fv(uniforms['u_charges'], chargeValsArr);
      if (uniforms['u_c']             !== undefined) gl.uniform1f(uniforms['u_c'], config.c);
      if (uniforms['u_worldBounds']   !== undefined) {
        gl.uniform4f(uniforms['u_worldBounds'],
          curBounds.minX, curBounds.maxX, curBounds.minY, curBounds.maxY);
      }
      if (uniforms['u_resolution'] !== undefined) {
        gl.uniform2f(uniforms['u_resolution'], canvas.width, canvas.height);
      }
      if (uniforms['u_isSigned'] !== undefined) {
        // Signed zero-crossing contour for periodic modes; envelope for moving_charge.
        // (draggable hides the contour toggle entirely; value is irrelevant there.)
        gl.uniform1i(uniforms['u_isSigned'],
          (mode === 'oscillating' || mode === 'dipole' || mode === 'hydrogen') ? 1 : 0);
      }
      if (uniforms['u_heatmapPeak'] !== undefined) gl.uniform1f(uniforms['u_heatmapPeak'], heatmapPeak);
      if (uniforms['u_accelPeak']   !== undefined) gl.uniform1f(uniforms['u_accelPeak'],   accelPeak);
      if (uniforms['u_bzChannel']   !== undefined) gl.uniform1i(uniforms['u_bzChannel'],   bzChannelUniform);
      if (uniforms['u_showHeatmap'] !== undefined) gl.uniform1i(uniforms['u_showHeatmap'], doHeatmap ? 1 : 0);
      if (uniforms['u_showContour'] !== undefined) gl.uniform1i(uniforms['u_showContour'], doContour ? 1 : 0);
      if (uniforms['u_softening']   !== undefined) gl.uniform1f(uniforms['u_softening'], config.softening ?? 0.01);
      if (uniforms['u_debugMode']   !== undefined) gl.uniform1i(uniforms['u_debugMode'], 0);

      // ── Draw ────────────────────────────────────────────────────────────────
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);

      rafId = requestAnimationFrame(tick);
    };

    // ── Context loss handling ─────────────────────────────────────────────────
    const onContextLost = (e: Event) => {
      e.preventDefault();
      glAlive = false;
      cancelAnimationFrame(rafId);
    };
    const onContextRestored = () => {
      glAlive = true;
      try {
        ({ program, uniforms } = createShaderProgram(gl, VERT_SRC, FRAG_SRC));
        historyTex = createFloat32Texture(gl, TEX_WIDTH, TEX_HEIGHT);
        ({ vao, vbo } = createFullscreenQuad(gl));
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        console.error('[WavefrontWebGLCanvas] Context restore failed:', err);
      }
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // ── ResizeObserver — capped DPR ──────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, WEBGL_MAX_DPR);
      canvas.width  = Math.round(canvas.clientWidth  * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    });
    ro.observe(canvas);

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      gl.deleteProgram(program);
      gl.deleteTexture(historyTex);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // mount-only: all live values read through refs

  return (
    <canvas
      ref={canvasRef}
      style={style}
    />
  );
}

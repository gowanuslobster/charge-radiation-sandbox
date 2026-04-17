// WavefrontWebGLCanvas — WebGL2 fragment-shader heatmap for the radiation overlay.
//
// Drop-in replacement for WavefrontOverlayCanvas (same prop interface).
// Evaluates the Liénard-Wiechert bZAccel field at every screen pixel via a GLSL
// fragment shader that replicates the full retarded-time solve.
//
// History is uploaded each frame as a 2D RGBA32F texture (TEX_WIDTH × TEX_HEIGHT).
// Normalization uses a 32×32 CPU probe + temporal EMA, with hard-reset and caching.
//
// draggable mode is intentionally unsupported — this component is only mounted for
// moving_charge and oscillating (ChargeRadiationSandbox enforces this).

import { useEffect, useRef, type CSSProperties, type RefObject, type MutableRefObject } from 'react';
import type { SimConfig } from '@/physics/types';
import type { ChargeHistory } from '@/physics/chargeHistory';
import type { WorldBounds } from '@/rendering/worldSpace';
import { createSamplerState, sampleWavefront } from '@/physics/wavefrontSampler';
import { computeContrastPeak, type HeatmapMode } from '@/rendering/wavefrontRender';
import {
  createShaderProgram,
  createFloat32Texture,
  createFullscreenQuad,
} from '@/rendering/webglUtils';

// ── History texture layout ────────────────────────────────────────────────────
//
// 2 texels per KinematicState, packed into a TEX_WIDTH × TEX_HEIGHT 2D texture.
// texel 2i+0 = (t_offset, pos.x, pos.y, vel.x)
// texel 2i+1 = (vel.y, accel.x, accel.y, 0.0)  ← one padding channel
//
// TEX_WIDTH × TEX_HEIGHT must equal 2 × MAX_HISTORY_SAMPLES.
// Dimensions chosen so both are within WebGL2's minimum MAX_TEXTURE_SIZE (2048).
const MAX_HISTORY_SAMPLES = 4096;
const TEX_WIDTH  = 512;
const TEX_HEIGHT = (2 * MAX_HISTORY_SAMPLES) / TEX_WIDTH;  // = 16; 512×16 = 8192 = 2×4096  ✓

// Fixed iteration counts for GPU loops.
const BINARY_SEARCH_ITERS = 12;   // ceil(log2(4096))
const NEWTON_ITERS = 28;           // profiling target range 24–32

// Normalization probe parameters. See "Normalization" section in the plan.
const NORM_PROBE_W   = 32;
const NORM_PROBE_H   = 32;
const NORM_EMA_ALPHA = 0.12;       // temporal smoothing; tune if flicker observed

// Phase I performance cap: limit the effective DPR for this canvas only.
// The CSS size is unchanged — the browser upscales the lower-res render buffer.
// Keeps fragment workload manageable on high-DPI / Retina displays without
// touching solver math, texture layout, or any other canvas.
// On a 2× display this caps pixel count at (1.5/2)² ≈ 56% of uncapped.
const WEBGL_MAX_DPR = 1.5;

// ── Props — identical to WavefrontOverlayCanvas ───────────────────────────────

type Props = {
  historyRef:        RefObject<ChargeHistory>;
  simulationTimeRef: MutableRefObject<number>;
  chargeRef:         MutableRefObject<number>;
  configRef:         MutableRefObject<SimConfig>;
  simEpochRef:       MutableRefObject<number>;
  bounds:            WorldBounds;
  demoMode:          'moving_charge' | 'oscillating';
  showHeatmap:       boolean;
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
// Structure:
//   fetchState(i)          — read 2 texels, return KinematicState
//   interpState(a,b,frac)  — linear interpolation between two states
//   historyLookup(t)       — fixed-count binary search + interpolation
//   solveRetarded(r_obs)   — bracketed Newton retarded-time solver
//   computeBZAccel(r, ret) — Liénard-Wiechert bZAccel
//   signedColor / envelopeColor — color mapping (matches wavefrontRender.ts)
//   main()                 — converts gl_FragCoord → world, evaluates field, outputs color

const FRAG_SRC = /* glsl */`#version 300 es
precision highp float;
precision highp int;

// ── Uniforms ─────────────────────────────────────────────────────────────────
uniform sampler2D u_history;      // RGBA32F, TEX_WIDTH × TEX_HEIGHT
uniform int       u_historyCount; // number of valid states this frame
uniform int       u_texWidth;     // TEX_WIDTH (for 2D address arithmetic)
uniform float     u_c;
uniform float     u_charge;
uniform vec4      u_worldBounds;  // (minX, maxX, minY, maxY)
uniform vec2      u_resolution;   // canvas physical pixel size (post-DPR)
uniform bool      u_isSigned;     // true = oscillating (signed), false = envelope
uniform float     u_peak;         // normalization ceiling (EMA-smoothed CPU probe)
uniform bool      u_showHeatmap;
uniform bool      u_showContour;
uniform float     u_softening;
uniform bool      u_debugMode;    // dev-only: output raw bZAccel to fragColor.r

out vec4 fragColor;

// ── KinematicState struct ─────────────────────────────────────────────────────

struct KinematicState {
  float t;
  vec2  pos;
  vec2  vel;
  vec2  accel;
};

// ── History texture fetch ─────────────────────────────────────────────────────

KinematicState fetchState(int i) {
  int t0 = 2 * i;
  int t1 = 2 * i + 1;
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

// Fixed-count binary search over the history texture.
// Returns the interpolated state at t_query, or clamps to the endpoints.
//
// The clamp-to-oldest path is a memory-safety guard only — it must never
// fire for visible pixels during normal operation (c-slider minimum prevents it).
KinematicState historyLookup(float t_query) {
  if (u_historyCount <= 0) {
    KinematicState zero;
    zero.t = 0.0; zero.pos = vec2(0.0); zero.vel = vec2(0.0); zero.accel = vec2(0.0);
    return zero;
  }
  KinematicState oldest = fetchState(0);
  KinematicState newest = fetchState(u_historyCount - 1);
  if (t_query <= oldest.t) return oldest;
  if (t_query >= newest.t) return newest;

  int lo = 0;
  int hi = u_historyCount - 1;
  for (int iter = 0; iter < ${BINARY_SEARCH_ITERS}; iter++) {
    int mid = (lo + hi) / 2;
    KinematicState s = fetchState(mid);
    if (s.t <= t_query) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo <= 1) break;
  }
  KinematicState s0 = fetchState(lo);
  KinematicState s1 = fetchState(hi);
  float span = s1.t - s0.t;
  float frac = (span > 0.0) ? (t_query - s0.t) / span : 0.0;
  return interpState(s0, s1, frac);
}

// ── Bracketed Newton retarded-time solver ────────────────────────────────────
//
// Residual: f(t) = -t - |r_obs - r(t)| / c   (t_obs = 0.0 after timestamp offset)
//
// Invariant: f(t_lo) > 0 and f(t_hi) <= 0, guaranteed by causality.
// Must hold for all visible pixels — enforced by c-slider minimum in ChargeRadiationSandbox.
//
// Per-iteration: compute f and df at current t_ret, shrink bracket with that residual,
// then accept Newton step if it stays in the (updated) bracket, else bisect.
KinematicState solveRetarded(vec2 r_obs) {
  if (u_historyCount <= 1) {
    return historyLookup(0.0);
  }

  KinematicState oldest = fetchState(0);
  KinematicState newest = fetchState(u_historyCount - 1);

  float t_lo = oldest.t;   // < 0 (offset-relative)
  float t_hi = 0.0;        // t_obs (= "now" in offset coordinates)

  // Initial endpoint residuals
  float R_lo = length(r_obs - oldest.pos);
  float f_lo = -t_lo - R_lo / u_c;         // > 0 by causality assumption
  float R_hi = length(r_obs - newest.pos);
  float f_hi = -0.0 - R_hi / u_c;          // ≤ 0

  // Initial guess: retarded time for an observer at r_obs relative to newest position
  float t_ret = -length(r_obs - newest.pos) / u_c;
  t_ret = clamp(t_ret, t_lo, t_hi);

  for (int iter = 0; iter < ${NEWTON_ITERS}; iter++) {
    KinematicState s = historyLookup(t_ret);
    vec2  R_vec = r_obs - s.pos;
    float R     = max(length(R_vec), 1e-10);
    float f     = -t_ret - R / u_c;
    // df/dt = -1 + (R_vec · vel) / (R c)
    // Derivation: dR/dt = -(R_vec·v)/R, so df/dt = -1 - dR/dt/c = -1 + (R_vec·v)/(Rc)
    float df    = -1.0 + dot(R_vec, s.vel) / (R * u_c);

    // Shrink bracket using residual at CURRENT t_ret (before choosing next point).
    // This keeps f_lo and f_hi consistent with their respective bracket endpoints.
    if (f > 0.0) { t_lo = t_ret; f_lo = f; }
    else         { t_hi = t_ret; f_hi = f; }

    // Choose next iterate from the narrowed bracket
    float candidate = (abs(df) > 1e-10) ? (t_ret - f / df) : t_ret;
    t_ret = (candidate > t_lo && candidate < t_hi) ? candidate : (t_lo + t_hi) * 0.5;
  }

  return historyLookup(t_ret);
}

// ── Liénard-Wiechert bZAccel ──────────────────────────────────────────────────

float computeBZAccel(vec2 r_obs, KinematicState ret) {
  vec2  R_vec  = r_obs - ret.pos;
  float R_eff  = sqrt(dot(R_vec, R_vec) + u_softening * u_softening);
  vec2  nHat   = R_vec / R_eff;
  vec2  beta   = ret.vel  / u_c;
  vec2  betaDot = ret.accel / u_c;
  float kappa  = 1.0 - dot(nHat, beta);
  float kappa3 = max(kappa, 1e-6);
  kappa3       = kappa3 * kappa3 * kappa3;
  // crossNBD = (nHat - beta) × betaDot  (z-component of 3D cross product)
  vec2  nBeta  = nHat - beta;
  float crossNBD = nBeta.x * betaDot.y - nBeta.y * betaDot.x;
  return -u_charge * crossNBD / (u_c * u_c * kappa3 * R_eff);
}

// ── Color mapping (must match wavefrontRender.ts) ─────────────────────────────

const vec3 WARM = vec3(1.0, 0.549, 0.118);      // (255,140,30)/255
const vec3 COOL = vec3(0.314, 0.392, 1.0);       // (80,100,255)/255

vec4 signedColor(float bZ, float peak) {
  float norm    = bZ / peak;
  float shaped  = tanh(norm * 1.4);
  float strength = pow(abs(shaped), 0.82);
  vec3 rgb = (shaped >= 0.0) ? WARM : COOL;
  return vec4(rgb * strength, strength);
}

vec4 envelopeColor(float bZ, float peak) {
  float norm    = abs(bZ) / peak;
  float strength = pow(clamp(norm, 0.0, 1.0), 0.78);
  return vec4(WARM * strength, strength);
}

// ── Main ─────────────────────────────────────────────────────────────────────

void main() {
  if (u_historyCount <= 0) { discard; return; }

  // Convert gl_FragCoord to world space.
  // WebGL: gl_FragCoord.y = 0 at bottom, matching world-space +Y-up convention.
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float worldX = u_worldBounds.x + uv.x * (u_worldBounds.y - u_worldBounds.x);
  float worldY = u_worldBounds.z + uv.y * (u_worldBounds.w - u_worldBounds.z);
  vec2 worldPos = vec2(worldX, worldY);

  // Solve for retarded state and evaluate field.
  KinematicState retState = solveRetarded(worldPos);
  float bZAccel = computeBZAccel(worldPos, retState);

  // Dev-only: bypass color mapping and output raw scalar for validation readback.
  if (u_debugMode) {
    fragColor = vec4(bZAccel, 0.0, 0.0, 1.0);
    return;
  }

  if (!u_showHeatmap && !u_showContour) { discard; return; }

  vec4 outColor = vec4(0.0);

  if (u_showHeatmap) {
    outColor = u_isSigned ? signedColor(bZAccel, u_peak)
                          : envelopeColor(bZAccel, u_peak);
  }

  if (u_showContour && u_isSigned) {
    float norm         = bZAccel / u_peak;
    float contourWidth = fwidth(norm) * 1.5;
    float contourMask  = 1.0 - smoothstep(0.0, contourWidth, abs(norm));
    vec4 contourColor  = vec4(0.88, 0.88, 0.88, 0.85);
    outColor = mix(outColor, contourColor, contourMask);
  }

  if (outColor.a < 0.01) { discard; return; }
  fragColor = outColor;
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export function WavefrontWebGLCanvas({
  historyRef,
  simulationTimeRef,
  chargeRef,
  configRef,
  simEpochRef,
  bounds,
  demoMode,
  showHeatmap,
  showContours,
  isPausedRef,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Stable refs to the latest prop values — read each RAF tick without re-mounting.
  const boundsRef      = useRef(bounds);
  const showHeatmapRef = useRef(showHeatmap);
  const showContoursRef = useRef(showContours);
  const demoModeRef    = useRef(demoMode);
  boundsRef.current       = bounds;
  showHeatmapRef.current  = showHeatmap;
  showContoursRef.current = showContours;
  demoModeRef.current     = demoMode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false });
    if (!gl) return;   // fallback handled by parent; should not reach here

    // ── GL setup ─────────────────────────────────────────────────────────────
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

    // Pre-allocated staging buffer for history packing
    const staging = new Float32Array(TEX_WIDTH * TEX_HEIGHT * 4);

    // Normalization sampler (reused across frames)
    const normSamplerState = createSamplerState();

    // Normalization bookkeeping — all stored in refs to avoid React re-renders
    let smoothedPeak      = 0;
    let prevNormEpoch     = NaN;
    let prevNormMode      = '' as typeof demoMode;
    let prevNormC         = NaN;
    let prevNormCharge    = NaN;
    let prevNormBounds    = { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN } as typeof bounds;

    // ── RAF loop ─────────────────────────────────────────────────────────────
    let rafId = 0;
    let glAlive = true;

    const tick = () => {
      if (!glAlive) return;

      const history   = historyRef.current;
      const tCurrent  = simulationTimeRef.current;
      const charge    = chargeRef.current;
      const config    = configRef.current;
      const epoch     = simEpochRef.current;
      const mode      = demoModeRef.current;
      const curBounds = boundsRef.current;
      const doHeatmap = showHeatmapRef.current;
      const doContour = showContoursRef.current;
      const paused    = isPausedRef.current;

      if (!doHeatmap && !doContour) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        rafId = requestAnimationFrame(tick);
        return;
      }

      const historyCount = history.isEmpty() ? 0 : history.count;

      // ── Pack history into staging buffer ──────────────────────────────────
      // Zero out the staging buffer to avoid stale data beyond historyCount.
      staging.fill(0);
      for (let i = 0; i < historyCount; i++) {
        const s  = history.stateAt(i);
        // Timestamp offset computed in float64 precision before cast to float32.
        const tOff = s.t - tCurrent;
        const t0   = 2 * i;
        const t1   = 2 * i + 1;
        staging[t0 * 4 + 0] = tOff;
        staging[t0 * 4 + 1] = s.pos.x;
        staging[t0 * 4 + 2] = s.pos.y;
        staging[t0 * 4 + 3] = s.vel.x;
        staging[t1 * 4 + 0] = s.vel.y;
        staging[t1 * 4 + 1] = s.accel.x;
        staging[t1 * 4 + 2] = s.accel.y;
        staging[t1 * 4 + 3] = 0.0;
      }

      // ── Upload history texture ────────────────────────────────────────────
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, TEX_WIDTH, TEX_HEIGHT,
        gl.RGBA, gl.FLOAT, staging,
      );

      // ── Normalization probe with EMA smoothing and caching ────────────────
      const epochChanged  = epoch   !== prevNormEpoch;
      const modeChanged   = mode    !== prevNormMode;
      const cChanged      = config.c !== prevNormC;
      const chargeChanged = charge  !== prevNormCharge;
      const boundsChanged =
        curBounds.minX !== prevNormBounds.minX ||
        curBounds.maxX !== prevNormBounds.maxX ||
        curBounds.minY !== prevNormBounds.minY ||
        curBounds.maxY !== prevNormBounds.maxY;

      const hardReset = epochChanged || modeChanged || cChanged || chargeChanged;

      if (hardReset || (!paused || boundsChanged)) {
        const heatmapMode: HeatmapMode = mode === 'oscillating' ? 'signed' : 'envelope';
        const scalars = sampleWavefront(normSamplerState, {
          history,
          simTime: tCurrent,
          charge,
          config,
          bounds: curBounds,
          gridW: NORM_PROBE_W,
          gridH: NORM_PROBE_H,
          simEpoch: epoch,
        });
        const rawPeak = computeContrastPeak(scalars, heatmapMode);

        if (hardReset || smoothedPeak === 0) {
          smoothedPeak = rawPeak;   // hard reset — bypass EMA
        } else {
          smoothedPeak = NORM_EMA_ALPHA * rawPeak + (1 - NORM_EMA_ALPHA) * smoothedPeak;
        }

        prevNormEpoch   = epoch;
        prevNormMode    = mode;
        prevNormC       = config.c;
        prevNormCharge  = charge;
        prevNormBounds  = { ...curBounds };
      }
      // else: paused + no relevant change → skip re-probe, reuse smoothedPeak

      const peak = Math.max(smoothedPeak, 1e-10);

      // ── Set uniforms ──────────────────────────────────────────────────────
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      if (uniforms['u_history'] !== undefined) gl.uniform1i(uniforms['u_history'], 0);
      if (uniforms['u_historyCount'] !== undefined) gl.uniform1i(uniforms['u_historyCount'], historyCount);
      if (uniforms['u_texWidth'] !== undefined) gl.uniform1i(uniforms['u_texWidth'], TEX_WIDTH);
      if (uniforms['u_c'] !== undefined) gl.uniform1f(uniforms['u_c'], config.c);
      if (uniforms['u_charge'] !== undefined) gl.uniform1f(uniforms['u_charge'], charge);
      if (uniforms['u_worldBounds'] !== undefined) {
        gl.uniform4f(uniforms['u_worldBounds'],
          curBounds.minX, curBounds.maxX, curBounds.minY, curBounds.maxY);
      }
      if (uniforms['u_resolution'] !== undefined) {
        gl.uniform2f(uniforms['u_resolution'], canvas.width, canvas.height);
      }
      if (uniforms['u_isSigned'] !== undefined) {
        gl.uniform1i(uniforms['u_isSigned'], mode === 'oscillating' ? 1 : 0);
      }
      if (uniforms['u_peak'] !== undefined) gl.uniform1f(uniforms['u_peak'], peak);
      if (uniforms['u_showHeatmap'] !== undefined) {
        gl.uniform1i(uniforms['u_showHeatmap'], doHeatmap ? 1 : 0);
      }
      if (uniforms['u_showContour'] !== undefined) {
        // Contour only available for oscillating (moving_charge envelope contour deferred to M8)
        gl.uniform1i(uniforms['u_showContour'],
          (doContour && mode === 'oscillating') ? 1 : 0);
      }
      if (uniforms['u_softening'] !== undefined) {
        gl.uniform1f(uniforms['u_softening'], config.softening ?? 0.01);
      }
      if (uniforms['u_debugMode'] !== undefined) {
        gl.uniform1i(uniforms['u_debugMode'], 0);  // false in production
      }

      // ── Draw ──────────────────────────────────────────────────────────────
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);

      rafId = requestAnimationFrame(tick);
    }

    // ── Context loss handling ─────────────────────────────────────────────
    const onContextLost = (e: Event) => {
      e.preventDefault();
      glAlive = false;
      cancelAnimationFrame(rafId);
    };
    const onContextRestored = () => {
      glAlive = true;
      // Recreate GPU resources and restart
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

    // ── ResizeObserver — keeps canvas pixel buffer sized with capped DPR ──
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


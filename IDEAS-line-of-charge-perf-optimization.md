# IDEAS — Performance optimization for multi-charge heatmap rendering

## Context

M13-A bumped the WebGL heatmap renderer from `MAX_CHARGES = 2` to
`MAX_CHARGES = 32` and shipped the first multi-charge transient mode
(Particle Beam, N = 7). With heatmap on, that mode renders perceptibly
laggier than the single-charge modes — not broken, but noticeably below the
60 FPS the other modes hit cleanly on the same hardware.

This document captures the diagnosis and the deferred optimization plan.
It is a sibling to `IDEAS-webGL-efficiency.md`, which covers the earlier
single-charge DPR cap and the manual-quality-selector follow-up. The work
described here is the multi-charge follow-on, surfaced by M13-A and
expected to matter more as M13-B/C/D add additional line-of-charge modes.

Decision today: **defer**. Particle Beam is shippable as-is. This file
exists so the next perf pass starts from a written analysis instead of a
fresh round of profiling.

---

## Where the cost is

The dominant cost is the GPU fragment shader. Per pixel per active charge:

- 1 retarded-time solve (`solveRetarded`, `WavefrontWebGLCanvas.tsx:253`)
- `NEWTON_ITERS = 28` outer iterations (`WavefrontWebGLCanvas.tsx:79`)
- Each outer iter calls `historyLookup` →
  `BINARY_SEARCH_ITERS = 12` inner iters
- Each inner iter does 2 `texelFetch` calls in `fetchState`
- Plus 1 final `historyLookup` after Newton converges

Per pixel per charge: roughly 28 × (12 × 2 + 2) ≈ **728 texture fetches +
solver math**. At a 1080p canvas × DPR 1.5 × 7 charges that is on the order
of 10⁹ texelFetches per second at 60 FPS — heavy enough that mid-tier GPUs
miss frame.

The CPU normalization probe is a secondary cost: a `NORM_PROBE_W ×
NORM_PROBE_H = 32 × 32` grid solved through `runNormalizationProbe` on
every Policy A frame, with a per-charge inner loop. At N = 7 that is
7,168 CPU retarded-time solves per frame in Particle Beam. Real, but well
below the GPU shader cost.

The per-frame texture upload is **not** the bottleneck. M13-A's
row-restricted `texSubImage2D` already caps it at
`chargeCount × ROWS_PER_CHARGE × TEX_WIDTH × 4` bytes — 224 KB for the
seven-charge beam, vs. the unrestricted 4 MB.

---

## Easy wins (low risk, can land any time)

These three changes are one-line adjustments. They trade a small amount
of quality for substantial frame-time savings, and any of them can ship
without touching physics, normalization semantics, or the CPU fallback.

### 1. Drop `WEBGL_MAX_DPR` from 1.5 to 1.0

File: `WavefrontWebGLCanvas.tsx:100`.

Reduces fragment shader work by ~2.25× on HiDPI / Retina displays.
The heatmap is band-limited (signed warm/cool gradient), so the visible
quality cost is small. This is the cleanest single-keystroke win.

### 2. Reduce `NEWTON_ITERS` from 28 to 16

File: `WavefrontWebGLCanvas.tsx:79`.

The bracketed Newton solver converges fast — 28 was picked conservatively
to absorb worst-case oscillating-source curvature. 16 should hold for the
modes we have today, but wants A/B verification before shipping:

- Hydrogen at low c (curved orbit + short causal horizon)
- Moving charge post-stop (acceleration discontinuity at the shell)
- Dipole at low c (two phase-locked oscillating sources)

If any of those show visible solver artifacts (banding near sharp field
features, mis-traced contour position), back off to 20 instead.

### 3. Shrink `NORM_PROBE_W/H` from 32 to 16

Files: `WavefrontWebGLCanvas.tsx:82-83`.

Cuts the CPU probe cost 4× (1024 cells → 256 cells). Affects only the
probe — does not touch shader output. Matters most for Policy A modes
(moving_charge, draggable, particle_beam) which probe every unpaused
frame; Policy B modes (oscillating, dipole, hydrogen) probe only on
invalidation and benefit less.

Pairs naturally with the manual-quality selector proposed in
`IDEAS-webGL-efficiency.md` — the probe-density knob can ride the same
preset.

---

## Deferred plan (structural, in priority order)

### 1. Half-resolution heatmap FBO + bilinear upscale

The biggest single lever after the easy wins. Render the heatmap into a
0.5× resolution offscreen framebuffer, then blit it to the canvas with
bilinear filtering. **4× shader-cost reduction** for nearly indistinguishable
visual output (the heatmap is smooth enough to tolerate it). The contour
pass stays at full resolution because it is edge-detected and would alias.

Shape:

- Add an FBO sized at `(canvas.width / 2, canvas.height / 2)`
- Heatmap pass writes to FBO; contour pass writes to canvas
- Composite pass samples FBO with `LINEAR` filtering and blends over the
  contour layer

Roughly half a day of work. Requires splitting the current single-pass
shader into heatmap-only and contour-only variants (or guarding by a new
`u_pass` uniform), plus FBO allocation and resize-handling in the RAF
loop.

### 2. Early-exit Newton

Add `if (abs(f) < tol) break;` inside the Newton loop. Pixels where the
charge is static (or where the bracket has already shrunk past tolerance)
exit after a handful of iterations instead of plowing through all 28 (or
16, post-easy-win 2). Particle Beam is the common case here — six of the
seven charges' retarded states are slowly-varying for any given pixel.

WebGL2 drivers handle dynamic-exit fixed loops fine in practice, but the
GLSL spec only guarantees fixed-trip loops. Worth measuring per-target
GPU; if some drivers refuse to converge faster, fall back to a chained
unroll structure.

Expected gain: 2–3× on cells with static charges. Pairs well with #1
(the savings compound).

### 3. GPU-side normalization probe

Replace the CPU `runNormalizationProbe` with a max-reduction pass on a
downsampled FBO. Rough recipe: render the active heatmap channel into a
small (e.g. 64×64) FBO, then mip-style reduce to a 1×1 max via repeated
half-size passes. Read back via `gl.readPixels` once per frame.

Eliminates the 7,168-solves-per-frame CPU cost in Particle Beam and
keeps the main thread free for input handling. Worth doing if Policy A
modes ever feel laggy after the GPU fragment cost is brought down.

### 4. Per-charge culling in the shader

A charge whose retarded position is outside the view bounds and whose
recent history doesn't trace through the view can be skipped on a
per-pixel basis. Tricky because the retarded position depends on the
pixel and the solver iterates to find it, but a coarse pre-pass that
estimates each charge's worst-case retarded-position bounding box could
let `main()` skip the full solve for distant charges.

Adds branch divergence (some pixels need the full solve, neighbors don't)
which can hurt on warp-based GPUs even when the average work goes down.
Worth measuring at MAX_CHARGES = 32 once M13-B/C/D land more populated
modes.

### 5. Render-on-change instead of every RAF tick

When paused (and after the post-pause settle), the shader output is
identical frame-to-frame. Skip the draw call entirely until something
changes (charge moved, channel switched, c moved, view panned/zoomed).

Already partially done for the normalization probe via
`isPausedRef.current` short-circuit. Extend the same pattern to the draw
call itself — guard `gl.drawArrays` behind a "dirty" flag set by all
the RAF-loop input watchers.

Cleanest win for the paused-and-thinking case but doesn't help the live
"watch radiation propagate" experience, which is exactly when the user
notices lag.

---

## Suggested staging

| Phase | Work | Expected gain |
|-------|------|---------------|
| Easy wins | Drop DPR cap to 1.0; cut Newton to 16; shrink probe to 16² | ~3–4× combined |
| Phase A | Half-res heatmap FBO (#1) | 4× shader cost |
| Phase B | Early-exit Newton (#2) | 2–3× on static-charge cells |
| Phase C | GPU normalization probe (#3) | Eliminates main-thread probe |
| Phase D | Per-charge culling (#4) | Variable; measure when MAX_CHARGES utilization is higher |
| Phase E | Render-on-change (#5) | 0× live, ~∞ paused |

Phase A alone likely gets Particle Beam to feel smooth on the hardware
that currently misses frame. Phases B–E are incremental beyond that.

---

## Out of scope here

- The CPU vector-field canvas (`VectorFieldCanvas.tsx`) — separate
  optimization story, not multi-charge-bound.
- The CPU fallback heatmap (`WavefrontOverlayCanvas.tsx`) — slow by
  design, used only when WebGL2/RGBA32F is unavailable.
- Physics changes (LW formula, retarded-time contract, softening) — none
  of the optimizations above touch the math, and none should.

These ideas are specifically about the **WebGL heatmap path under
multi-charge load**. They compose with, and do not replace, the
single-charge efficiency work in `IDEAS-webGL-efficiency.md`.

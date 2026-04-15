# IDEAS: WebGL Renderer Transition (Path B)

## 1. Purpose

The CPU-based Lienard-Wiechert renderer has done its job: it established the
physics contract, validated the demo modes, and made the pedagogical structure
clear. It also exposed the ceiling of the current architecture.

Two limits now matter:

- **Spatial aliasing of thin radiation features.** Sudden-stop shells and narrow
  oscillation fronts can fall between sample points on a coarse CPU grid,
  especially at far zoom. Scalar-space smoothing improves appearance but cannot
  recover field structure that was never sampled.
- **Scaling pressure for future modes.** A denser visual field, higher-quality
  heatmap, or multi-charge scene multiplies retarded-time solves on the CPU.
  That is acceptable for a sparse teaching grid; it is not the right long-term
  path for continuous heatmaps or rich superposition scenes.

WebGL is the right answer for dense rasterized field displays because it moves
the LW evaluation from a few thousand CPU samples to a full-screen parallel GPU
field evaluation.

This document proposes a **narrow, staged renderer transition**, not a full
platform rewrite.

## 2. Guiding Principles

- **Keep the existing physics model.** The WebGL path does not replace the
  Lienard-Wiechert equations or the CPU-side kinematic model. It only changes
  how dense visual layers are rendered.
- **Keep the CPU as the source of truth.** React, demo-mode logic,
  `ChargeHistory`, and paused-only sequential tools remain CPU-owned.
- **Migrate one visual layer at a time.** The first WebGL milestone delivers a
  continuous heatmap and a correct zero-crossing contour for `oscillating` mode.
  It does not simultaneously replace arrows, streamlines, or the `moving_charge`
  envelope contour.
- **Use the CPU physics implementation as the oracle for point probes.** The
  current CPU LW evaluator is the correctness reference for discrete sampled
  values at specific world coordinates. The current CPU heatmap image is *not*
  the visual oracle because it is itself limited by coarse-grid spatial
  aliasing.

## 3. Recommended Scope

### What stays on the CPU

- UI, React state, and interaction handling
- Charge kinematics and demo-mode stepping
- `ChargeHistory` construction, pruning, and interpolation policy
- Cursor readouts and probe-style validation tools
- Streamlines / field lines for paused-state inspection
- The existing vector-arrow renderer, at least in the first WebGL milestone

### What moves to the GPU first

The first WebGL milestone delivers:

- The radiation heatmap for `moving_charge` and `oscillating`
- The zero-crossing contour for `oscillating` (shader-native, consistent with
  the heatmap's continuous field)

**Colormap assignment by demo mode (current and future intent):**

| Mode | Colormap | Contour |
|------|----------|---------|
| `oscillating` | Signed `bZAccel` (warm/cool dual-hue) | Zero-crossing contour (shader-native, milestone 1) |
| `moving_charge` | Envelope `abs(bZAccel)` (single warm-hue) | Envelope threshold contour (deferred to milestone 2) |
| `draggable` | Envelope `abs(bZAccel)` (single warm-hue) | None (future consideration) |

If a future shader path is added for `draggable`, the envelope colormap is the
right default. The signed colormap would show a sign structure with no natural
oscillation interpretation, while the envelope view directly shows where
radiation has propagated after drag-induced acceleration events.

The `moving_charge` envelope contour is **not** part of milestone 1. It has a
normalization-coupling problem (the threshold depends on the global field
maximum, which requires either a two-pass GPU reduction or a separate CPU probe)
that belongs in milestone 2.

The reason for including the `oscillating` zero-crossing contour in milestone 1
is visual consistency: the fragment shader already evaluates `bZAccel` at every
pixel, so drawing a contour where it crosses zero is comparatively cheap and
architecturally aligned with the heatmap pass. Leaving the CPU marching-squares
contour active alongside the GPU heatmap would produce a visibly misaligned
result because the CPU contour is extracted from the same coarse grid the GPU
path is intended to replace.

## 4. Data Model for the GPU

### History texture format

The history buffer is uploaded to the GPU as a floating-point texture. This is
the primary design, not a fallback.

Why textures over uniform arrays:

- Uniform-array limits are too restrictive for realistic history depth
- Low-`c` views require longer visible causal horizons
- Future multi-charge support will expand the history footprint quickly
- Texture sampling is the natural way to represent time-indexed kinematic data
  inside a fragment shader

### Texture packing layout

`KinematicState` has 7 floats: `t, pos.x, pos.y, vel.x, vel.y, accel.x,
accel.y`. An `RGBA32F` texel holds 4 floats; there is no natural single-texel
fit. The recommended milestone-1 layout is **2 texels per state**:

```
texel 2i+0 = (t_offset, pos.x, pos.y, vel.x)
texel 2i+1 = (vel.y, accel.x, accel.y, 0.0)   // one channel padding
```

All texels are packed into a 2D texture of dimensions `TEX_WIDTH × TEX_HEIGHT`, where
`TEX_WIDTH = 512` and `TEX_HEIGHT = 16` (8192 total texels = `2 × MAX_HISTORY_SAMPLES`).
Both dimensions are within WebGL2's minimum guaranteed `MAX_TEXTURE_SIZE` (2048), unlike a
single-row design that would require width 8192 — which is not guaranteed on all hardware.
`MAX_HISTORY_SAMPLES` should be fixed at compile time (e.g., 4096).

In the shader, state `i` is retrieved as:

```glsl
int t0 = 2 * i;
int t1 = 2 * i + 1;
vec4 a = texelFetch(u_history, ivec2(t0 % TEX_WIDTH, t0 / TEX_WIDTH), 0);
vec4 b = texelFetch(u_history, ivec2(t1 % TEX_WIDTH, t1 / TEX_WIDTH), 0);
// a = (t_offset, pos.x, pos.y, vel.x)
// b = (vel.y, accel.x, accel.y, _)
```

`TEX_WIDTH` is passed to the shader as a uniform (`u_texWidth`) so the 2D addressing formula
is not hardcoded in the GLSL.

This layout is simple and robust for the single-charge first milestone. More
specialized layouts may be worth considering later if multi-charge bandwidth or
shader coherence becomes the bottleneck, but that complexity is not justified
up front.

The padding channel in `texel 2i+1` should be written explicitly as `0.0`
during upload. It is expected to be unused by the shader, but leaving it
uninitialized creates an avoidable latent correctness trap.

### Timestamp offsetting

Timestamps are stored **relative to the current simulation time**. On each
upload, subtract `t_current` from every stored timestamp before packing into
the texture. The most recent state has `t_offset ≈ 0`; older states have
negative values.

This keeps all float32 timestamp values near zero regardless of how long the
simulation has been running, preserving relative precision for the retarded-time
solve. The observation time passed to the shader is always `0.0` (i.e., "now"),
and the retarded time solution is a negative offset from that.

The offset should be computed on the CPU in float64 before values are written
into the float32 upload buffer. Do not cast timestamps to float32 first and
then subtract; that defeats the precision benefit near `t_current`.

### Texture upload strategy

Use a **full re-upload each frame** on the 2D history texture. Allocate storage
once, then update via `texSubImage2D` against a pre-allocated `Float32Array`
staging buffer. Do not reallocate texture storage every frame unless profiling
shows that the simpler implementation is acceptable and still comfortably below
budget.

The history size is bounded by `MAX_HISTORY_SAMPLES` entries;
at typical simulation parameters, the packed texture is a few hundred kilobytes.
This is acceptable at 60 FPS for the single-charge case.

A ring-buffer approach (partial update with an explicit head pointer) would
reduce upload cost but adds wrap-around complexity in the shader's indexing
arithmetic and in shader-side bracketing logic. Defer that optimization unless
profiling shows upload bandwidth or CPU-side serialization is a bottleneck.

### Shader-side history lookup

Each Newton step needs the source state at a candidate retarded time `t_ret`.
That means the shader must:

1. Find the two adjacent history states whose timestamps bracket `t_ret`
2. Linearly interpolate between them

The history texture is time-ordered, so the natural bracketing algorithm is a
fixed-count binary search. The implementation must guarantee interval shrinkage
on every iteration; a naive `lo = mid` / `hi = mid` update rule can stall when
the interval size reaches 1. The design requirement is:

- Fixed iteration count
- Explicit handling of clamp cases
- Final pair is adjacent or clamped to an endpoint

**Required edge cases:**

- `historyCount == 0`: output zero field rather than reading uninitialized
  texture memory
- Query older than the oldest state: clamp to the oldest state
- Query newer than the newest state: clamp to the newest state

The clamp-to-oldest rule is a **memory-safety guard, not a physics fallback**.
It must never trigger for visible on-screen pixels during normal operation. If
it fires, the shader silently renders the oldest recorded state (a static
Coulomb field at that position) for the affected fragments — producing a harsh
unphysical "glass wall" where wave structure abruptly vanishes at the edge of
the history buffer. Preventing this requires a per-mode c-slider minimum (see
section 5, "Handling low-c scenarios") that guarantees the causal horizon for
all visible pixels is always fully contained within the uploaded history.

`BINARY_SEARCH_ITERS = ceil(log2(MAX_HISTORY_SAMPLES))` is the correct starting
rule. For `4096` states, that is `12`.

## 5. First WebGL Milestone

### Goal

Render the radiation heatmap at screen resolution and draw the `oscillating`
zero-crossing contour in a fragment shader, while leaving arrows on the CPU.

### Why this scope

- Directly addresses the main visible weakness: coarse-grid aliasing in the
  heatmap.
- The zero-crossing contour for `oscillating` is comparatively cheap and
  architecturally aligned: the shader already computes `bZAccel` per pixel, and
  drawing a contour where it crosses zero requires only a narrow threshold check.
  Omitting it would leave the CPU marching-squares contour active alongside the
  GPU heatmap, producing a visibly misaligned result that looks like a physics
  error.
- Produces a clear user-facing benefit without requiring a full renderer rewrite.
- Keeps the scope testable and reviewable.
- Preserves the CPU arrow grid as a pedagogical reference during validation.

### Core shader responsibilities

- Upload `ChargeHistory` to the GPU as a 2D `RGBA32F` texture (`TEX_WIDTH × TEX_HEIGHT`)
  using the packing layout described in section 4.
- For each fragment, solve the retarded-time equation using a fixed-count
  bracketed Newton solver (see below).
- Reconstruct the retarded kinematic state from the history texture via a
  binary search in the shader (see below).
- Evaluate the LW field decomposition to obtain `bZAccel`.
- Output:
  - Signed `bZAccel` heatmap in `oscillating`
  - Zero-crossing contour line in `oscillating` rendered as a narrow scalar
    threshold band around `bZAccel = 0`, anti-aliased in screen space
  - Envelope `abs(bZAccel)` heatmap in `moving_charge`
  - No contour in `moving_charge` (envelope contour deferred to milestone 2)

### Shader loop structure

The fragment shader contains two nested fixed-count loops:

**Inner loop — history bracketing search:**
Given a candidate `t_ret`, find the two adjacent history states whose timestamps
bracket it. This is implemented as a fixed-count binary search over the uploaded
texture row.

```
MAX_HISTORY_SAMPLES = 4096
BINARY_SEARCH_ITERS = 12   // ceil(log2(4096))
```

Required uniforms: `u_historyCount` (number of valid states uploaded this frame)
and `u_history` (the texture sampler).

**Outer loop — bracketed Newton retarded-time solver:**
The retarded-time equation is `t_ret = t_obs - |r_obs - r(t_ret)| / c`. The
solver uses a **bracketed Newton** strategy — a single unified loop that gives
Newton's quadratic convergence when the guess is well-behaved, and guaranteed
bisection convergence otherwise.

*Initial conditions:*
- Bracket: `t_lo = oldest_history_time`, `t_hi = t_obs`. This interval is
  always valid by causality — the retarded solution must lie within it.
- Initial guess: `t_ret = t_obs - |r_obs - r_current| / c`, where `r_current`
  is the most recent history position (the `t_hi` endpoint). Clamp the initial
  guess into `[t_lo, t_hi]` before the first iteration.

*Per-iteration update rule:*
1. Look up the interpolated source state at the current `t_ret` using the inner
   binary search.
2. Compute the Newton step from the residual and its derivative.
3. If the Newton candidate stays inside `[t_lo, t_hi]`, accept it and update
   the bracket endpoint whose sign matches the residual sign.
4. If the Newton candidate would leave the bracket, take the bisection midpoint
   instead.

This eliminates divergence and oscillation within the intended operating regime,
as long as the retarded root remains inside the valid bracketed history interval
and the source worldline stays subluminal. No separate fallback phase is needed.

```
NEWTON_ITERS = 24..32   // initial target range; final value chosen by profiling
```

The bracketed Newton approach makes the iteration count a performance tuning
parameter, not a correctness parameter — the bracket guarantees the solver
converges even if `NEWTON_ITERS` is set conservatively low.

### Handling low-`c` scenarios

The `c` parameter is a key pedagogical feature. At low `c`, the retarded time
is further in the past, requiring a larger history buffer and more Newton
iterations to converge.

**Two distinct constraints both bound the c-slider minimum:**

1. **Subluminality:** `c > v_peak` for the active demo mode. The shader assumes
   a timelike worldline; a superluminal charge has no valid retarded solution.

2. **Horizon depth:** The causal horizon for the furthest visible pixel must fit
   within `MAX_HISTORY_SAMPLES`. The required history depth is
   `maxCornerDist / (c − v_peak)` time units, and at timestep `dt` that is
   `maxCornerDist / ((c − v_peak) * dt)` samples. The horizon constraint is:

   ```
   c_min = v_peak + maxCornerDist / (MAX_HISTORY_SAMPLES * dt)
   ```

   For one illustrative parameter set (`maxCornerDist ≈ 5`,
   `MAX_HISTORY_SAMPLES = 4096`, `dt = 0.01`), the horizon term evaluates to
   approximately `0.12`. Any per-mode minimum derived from this should be
   treated as an example, not a final constant, because the bound also depends
   on the supported visible-domain size.

**The UI c-slider policy must respect these constraints.** There are two viable
designs:

- a conservative global minimum derived from the worst supported visible-domain
  size and mode speed
- a dynamic lower bound that depends on the active mode and current visible
  domain

The "clamp to oldest state" rule in the shader remains only a memory-safety
guard; it must never fire for visible pixels during normal operation.

These constants must be verified empirically before finalizing: inspect
`maxHistoryTime` (computed in `ChargeHistory` as
`maxCornerDist(sourcePos, viewBounds) / (c − speed)`) at the minimum supported
`c` value and confirm the history depth stays within the texture budget on real
target devices. Do not assume `4096` is automatically sufficient.

### Canvas and RAF architecture

`WavefrontOverlayCanvas` uses `canvas.getContext('2d')`. This cannot coexist
with WebGL on the same canvas element. The transition requires:

1. Replace `WavefrontOverlayCanvas` with a new `WavefrontWebGLCanvas` component
   that calls `canvas.getContext('webgl2')`.
2. Keep the same z-index layering: WebGL canvas at `zIndex: 10`, arrow canvas
   at `zIndex: 15` (unchanged).
3. `WavefrontWebGLCanvas` reads `ChargeHistory` from the same ref as before
   (`historyRef`) inside its RAF loop — no React re-render signaling needed.
4. The CPU `wavefrontSampler` and `wavefrontRender` pipeline is disabled when
   the WebGL path is active. If the WebGL context fails to initialize, the CPU
   path serves as the fallback (see section 7).

Initialization should probe capabilities on a throwaway canvas before choosing
the active overlay path. It is not enough to check only whether `webgl2`
exists; the app must also verify that the specific floating-point history-texture
path required by the renderer can be created successfully.

The `useEffect` that initializes the WebGL context and starts the RAF loop
**must return a cleanup function** that:
- Cancels the active RAF via `cancelAnimationFrame(rafIdRef.current)`, where the
  RAF ID is stored in a `useRef` (not state) to avoid triggering re-renders

This cleanup is required to prevent zombie render loops in React Strict Mode,
which intentionally mounts, unmounts, and remounts components in development.
Without it, each remount spawns a new RAF loop that never stops.

The component should also handle WebGL context loss during normal operation. On
`webglcontextlost`, stop rendering and avoid issuing further WebGL calls. On
`webglcontextrestored`, recreate GPU resources and resume the RAF loop.

### Constraints

- Target `WebGL2`
- Use a fixed maximum iteration count in GLSL — no dynamic unbounded loops
- Upload history in `RGBA32F` floating-point texture format (see section 4)
- Use `texelFetch` + manual interpolation; do not rely on native linear
  filtering for floating-point textures
- Store timestamps offset-relative to `t_current` (see section 4)
- Validate against CPU point-probe values, not the CPU heatmap image

## 6. Acceptance Criteria for Milestone 1

A milestone-1 build is considered stable when all of the following hold:

**Numerical:**
- GPU and CPU probe-point field values agree within a small absolute tolerance
  tied to a defined scene-scale reference peak, rather than a fragile
  point-local relative error near zero crossings. A good starting rule is:
  `abs(gpu - cpu) <= 0.02 * referencePeak`, where `referencePeak` is computed
  from a standard validation probe set or domain sample excluding the softening
  radius.
- Probe set covers explicit regions, not just a raw count. It should include at
  least:
  - one point inside the radiation shell
  - one point near the shell peak
  - one point outside the shell in the far field
  - one point near a zero crossing in `oscillating`
  - one off-axis point
  - one point at extreme zoom-out distance
- Validated in both `oscillating` and `moving_charge` modes, at `c = 1.0` and
  at a low-`c` value within the actually supported slider range.

**Visual:**
- No coarse-grid dropout islands visible in the `moving_charge` radiation shell
  at far zoom.
- `oscillating` heatmap shows continuous phase structure without staircase bands.
- `oscillating` zero-crossing contour aligns with the continuous field visible
  in the heatmap (no marching-squares offset artifact).
- Heatmap and contour remain stable under zoom and pan.
- Current UI controls and interaction model are unchanged.

**Performance:**
- ≥30 FPS on a clearly documented reference configuration. At minimum, record:
  viewport size, test mode, `c` value, and hardware / GPU class used for the
  measurement.

**Validation artifact:**
- Milestone 1 should produce a repeatable probe-validation artifact: either a
  small validation script or a browser-side diagnostic path that samples CPU
  and GPU values at the standard probe set and reports deltas.
- A written sign-off note should record the hardware and configurations used for
  performance and correctness validation.

## 7. Fallback Behavior

If the app cannot obtain a usable `WebGL2` context or the required floating-point
texture support (`RGBA32F`) is unavailable:

- The `WavefrontWebGLCanvas` component detects the failure at initialization
  time and sets a React state flag.
- The CPU `WavefrontOverlayCanvas` path activates as a lower-fidelity fallback
  rather than a visually equivalent replacement.
- An inline banner is displayed above the heatmap area stating that the
  high-fidelity heatmap requires compatible GPU hardware, and that the
  simulation is running in a lower-fidelity fallback mode. The banner should
  be concise and student-friendly — one or two sentences, no error codes.
- All other app functionality remains intact.

Do not silently fall back to a lossy representation that corrupts the physics
(e.g., 8-bit normalized textures for history storage).

## 8. Subsequent WebGL Milestones

### Shader-native envelope contour for `moving_charge`

Once the milestone-1 heatmap is stable, add the envelope contour for
`moving_charge`. The design must resolve the normalization-coupling problem:
the current CPU contour threshold is a fraction of the field's global maximum,
which the GPU does not have access to in a single-pass render.

Options:
- Two-pass GPU render: first pass reduces the scalar field to find the maximum;
  second pass draws the heatmap and threshold contour.
- CPU probe: keep a lightweight CPU pass that samples a coarse grid to estimate
  the normalization scale and passes it as a uniform.
- Fixed physical threshold: decouple the contour from display normalization
  entirely; use an absolute field magnitude threshold calibrated to typical
  simulation values.

This decision should be made as part of milestone 2 planning.

### Multi-charge heatmap superposition

After the single-charge shader path is correct, extend the GPU field evaluation
to sum multiple independent LW contributions. This is the real payoff for Path
B beyond visual smoothness.

This should be a separate milestone.

### Instanced vector arrows

Optional and deferred. The current CPU arrow renderer already works and is
pedagogically useful. Do not make shader arrows part of the initial WebGL
transition unless profiling later proves they are the bottleneck.

## 9. What Is Explicitly Out of Scope for the First WebGL Step

- Replacing the entire renderer stack in one pass
- Shader-native arrows
- Multi-charge support
- Streamlines / field lines
- The `moving_charge` envelope contour
- The `draggable` mode heatmap (CPU path continues for draggable in milestone 1)
- Speculative optimization before a single-charge fragment-shader heatmap exists

## 10. Validation Strategy

### Numerical validation

- Compare GPU and CPU field values at selected probe points in world space
  (see acceptance criteria in section 6 for probe coverage and tolerances)
- Verify sign structure in `oscillating`
- Verify shell location and envelope structure in `moving_charge`
- Test at both nominal `c` (1.0) and a low-`c` value within the actually
  supported slider range

### Visual validation

- Do **not** use the CPU heatmap image as a pixel-matching oracle; it has known
  coarse-grid aliasing defects that Path B is intended to remove
- Far-zoom sudden-stop shell no longer shows coarse-grid dropout islands
- `oscillating` heatmap shows continuous phase structure without staircase bands
- `oscillating` zero-crossing contour aligns with the heatmap field (not offset
  by marching-squares grid quantization)
- Heatmap remains stable under zoom and pan
- Current UI model and controls remain unchanged

## 11. Recommended Milestone Order

1. **WebGL heatmap + oscillating zero-crossing contour** (milestone 1, this
   document)
2. **Shader-native envelope contour for `moving_charge`** (resolve normalization
   coupling, milestone 2)
3. **Paused CPU streamlines** as a separate pedagogical overlay milestone
4. **Multiple charges** once the shader path is stable
5. **Optional shader arrows** only if later justified by performance or visual
   consistency

## 12. Bottom Line

WebGL is the right long-term rendering direction. The first milestone remains
narrow but complete:

- Fragment-shader heatmap for `moving_charge` and `oscillating`
- Shader-native zero-crossing contour for `oscillating` (comparatively cheap,
  and required for visual consistency)
- Texture-backed history upload with explicit packing layout and timestamp
  offsetting from the start
- Bracketed Newton solver with robust convergence inside the valid history
  bracket — no separate fallback phase needed
- A c-slider policy that prevents the causal horizon from exceeding the history
  buffer for visible pixels
- CPU renderer retained as the validation oracle and fallback
- `moving_charge` envelope contour and arrows left alone for now

That path solves the current fidelity problem without turning the next milestone
into a full-engine rewrite, and avoids both the transitional visual inconsistency
of mixing a GPU heatmap with a CPU contour, and the numerical failure modes of
an unbounded solver.

# IDEAS — WebGL Efficiency on Lower-Tier Hardware

## Context

The WebGL heatmap introduced in M7 evaluates the radiation field per pixel in a
fragment shader. That gives the sandbox its main visual win over the old CPU
sampled heatmap, but it also means performance scales directly with rendered
pixel count.

On lower-tier hardware, especially integrated GPUs and HiDPI / Retina displays,
the heatmap can still make the app feel uneven even when it remains functionally
correct. The visible symptom is not usually a total failure to render; it is an
irregular frame cadence:

- several simulation steps update quickly
- then the screen appears to stall briefly
- then a few more updates appear

This document records the next practical efficiency ideas after the already
implemented **Phase I DPR cap**.

## Already implemented: Phase I DPR cap

The first low-risk optimization is already in place:

- the WebGL heatmap canvas uses a capped effective DPR
- CSS size is unchanged
- only the WebGL backing buffer is reduced

This is the correct first move because it reduces fragment workload without
touching solver math, heatmap semantics, or fallback behavior.

## Recommended next step: manual internal render scale

The next simple and safe performance lever is to add a **manual render scale**
for the WebGL heatmap path.

### Mechanism

The canvas backing size becomes:

```ts
canvas.width  = Math.round(canvas.clientWidth  * effectiveDpr * renderScale);
canvas.height = Math.round(canvas.clientHeight * effectiveDpr * renderScale);
```

where:

- `effectiveDpr` is the already-capped DPR
- `renderScale` is a new quality multiplier in the range `(0, 1]`

The CSS size remains unchanged, so the browser stretches the lower-resolution
render target.

### Why this is the right Phase II

- It directly reduces fragment workload.
- It preserves physics correctness.
- It is independent of GPU model detection.
- It is much lower risk than changing Newton iteration counts.
- It composes cleanly with the existing DPR cap.

### Suggested preset values

- `High` → `renderScale = 1.0`
- `Medium` → `renderScale = 0.85`
- `Low` → `renderScale = 0.70`

These values are intentionally conservative. The goal is to reduce cost while
avoiding an obviously blurry heatmap.

## Next practical lever: normalization probe cost

The current WebGL path still does a CPU-side normalization probe in the same
RAF loop:

- `sampleWavefront(...)`
- currently `32 × 32`
- recomputed whenever the scene is running or when paused bounds change

That is not the dominant cost on strong hardware, but it is still meaningful
main-thread work on weaker machines.

### Low-risk follow-up

Tie probe density to the same manual quality preset:

- `High` → `32 × 32`
- `Medium` → `24 × 24`
- `Low` → `16 × 16`

Optional follow-up:

- on lower quality settings, refresh the normalization probe every other running
  frame instead of every frame

This slightly reduces normalization responsiveness, but it does not change the
field solve itself.

## Why not the other ideas first?

### 1. Hardware-name detection

Do not use GPU-name detection (for example via `WEBGL_debug_renderer_info`) as
the main strategy.

Reasons:

- poor browser support
- privacy / fingerprinting limitations
- brittle maintenance burden

Performance should be controlled empirically, not by maintaining a renderer
whitelist.

### 2. Automatic dynamic resolution scaling

Auto-scaling is a plausible later enhancement, but it should not be the next
step.

Reasons:

- it introduces visual "popping" or blur breathing
- frame-time heuristics can be noisy
- it makes performance behavior harder to reason about during development

The manual-quality path is simpler and easier to validate first.

### 3. Solver iteration reduction

Reducing binary-search or Newton iterations is not the right early optimization.

Reasons:

- correctness-sensitive, especially at low `c`
- harder to validate visually
- current shader constants are baked into the shader source, not cheap runtime
  knobs

This belongs in a later, more deliberate performance pass if render-scale and
probe-cost reductions are not enough.

## Recommended staged plan

### Phase I — done

- Cap effective DPR for the WebGL heatmap canvas.

### Phase II — next simple improvement

- Add a manual heatmap quality selector that controls internal render scale.

### Phase III — if more help is needed

- Tie CPU normalization probe density to the same quality selector.
- Optionally reduce normalization probe cadence on lower quality settings.

### Phase IV — later / dedicated performance work

- Automatic dynamic resolution scaling
- Solver-quality variants
- Broader frame-pacing / scheduling work

## Scope boundary

These ideas are specifically about the **WebGL heatmap path**. They should not
change:

- the CPU vector-field canvas sizing
- the LW physics equations
- the retarded-time solver contract
- the current CPU fallback semantics

The goal is to reduce rendering cost while preserving the pedagogical meaning of
the current overlays.

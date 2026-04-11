# Project Foundation: Liénard-Wiechert (LW) Electrodynamics Sandbox with Point Charges

## Prior Work

### field-sandbox

This is an electrostatic field & potential visualizer for various point charge configurations, along with dynamics of test charges that respond to the electric field presented by the placed static charges, but which do not themselves act back on the field to alter it. This visualization is excellent and should be the template for how electric field arrows should look, and for how a student would interact with the various control and view panels that we 

### wave-optics-sandbox

This was my initial try at simulating electrodynamics as a natural progression for the student who started understanding electrostatics in field-sandbox. However, it failed ultimately because my electric and magnetic field solver was a sophisticated grid based 2D solver (Ex, Ey, and Bz) that follows a sophisticated approach to simulating the EM field dynamics, but which is not capable of smoothly mapping from a known "static" picture of point charges and fields to the dynamic one with wave motion in the field once those charges start moving. There are interesting ideas in this repo but we need to leave that as is and move on to implementing a totally different approach to EM dynamics, the Lienard-Wiechert approach.

## 1\. The Core Motivation: Why FDTD Failed for Kinematics

The previous engine used a 2D Finite-Difference Time-Domain (FDTD) solver (Yee Grid + CPML boundaries). While excellent for simulating optics and materials, it was fundamentally incompatible with the pedagogical goal of moving point charges in a vacuum.

* **The Dimensionality Problem ("Flatland"):** A 2D FDTD grid assumes infinite translational symmetry along the Z-axis. A "point charge" in FDTD is physically an infinitely long charged wire. Its field decays as $1/r$ (and waves decay as $1/\\sqrt{r}$). To make it look like a 3D point charge, artificial $1/r \\rightarrow 1/r^2$ rendering projections had to be applied.
* **The Statics Problem:** FDTD is a dynamic wave solver ($\\nabla \\times E$ and $\\nabla \\times B$). It hates static fields (DC). Seeding a perfect Coulomb field into a bounded grid caused immediate numerical noise ("ghost curl" from staggered grids) and violent boundary reflections from the CPML. Teaching statics required "freezing" the solver entirely.

**The Solution:** The Liénard-Wiechert (LW) potentials are the exact, analytical solutions to Maxwell’s equations for moving point charges in a 3D vacuum. By adopting LW, the engine abandons the grid entirely. Space is treated as empty; only the exact positions and histories of the charges dictate the field.

## 2\. The Mathematical Framework

The LW method shifts from an Eulerian perspective (updating a grid step-by-step) to a Lagrangian perspective (calculating the field at any pixel based strictly on the history of the particles).

### A. The Retarded Time

Information travels at the speed of light ($c$). The field at an observation point $\\vec{r}$ at the current time $t$ is not determined by where the charge is *now*, but where it *was* when its light began traveling to the observation point.
This is the **retarded time ($t\_{ret}$)**, defined by the implicit equation:
$$t\_{ret} = t - \\frac{|\\vec{r} - \\vec{r}*s(t*{ret})|}{c}$$
Where $\\vec{r}*s(t*{ret})$ is the position of the source charge at the retarded time.

### B. The Electric Field ($\\vec{E}$)

The exact LW equation for the electric field of a moving charge elegantly splits into two parts:
$$\\vec{E}(\\vec{r}, t) = \\vec{E}*{vel} + \\vec{E}*{accel}$$

1. **The Velocity Field (Near-Field / Coulomb):**
This term represents the static/quasi-static field. It drops off as **$1/R^2$** (true 3D Coulomb decay) and points away from the *extrapolated* current position of the charge.
$$\\vec{E}*{vel} = \\left\[ \\frac{q}{4\\pi\\epsilon\_0} \\frac{\\hat{n} - \\vec{\\beta}}{\\gamma^2 (1 - \\vec{\\beta}\\cdot\\hat{n})^3 R^2} \\right]*{ret}$$
2. **The Acceleration Field (Far-Field / Radiation):**
This term ONLY exists if the charge is accelerating. It represents Bremsstrahlung radiation. It drops off as **$1/R$** and is strictly transverse to the direction of propagation.
$$\\vec{E}*{accel} = \\left\[ \\frac{q}{4\\pi\\epsilon\_0 c} \\frac{\\hat{n} \\times ((\\hat{n} - \\vec{\\beta}) \\times \\dot{\\vec{\\beta}})}{(1 - \\vec{\\beta}\\cdot\\hat{n})^3 R} \\right]*{ret}$$

*(Note: $\\vec{\\beta} = \\vec{v}/c$, $\\dot{\\vec{\\beta}} = \\vec{a}/c$, $\\hat{n}$ is the unit vector from the retarded position to the observation point, and $R$ is the distance. All values inside the brackets must be evaluated at $t\_{ret}$.)*

### C. The Magnetic Field ($\\vec{B}$)

In the LW framework, the magnetic field comes entirely "for free." It is simply the cross product of the direction of propagation ($\\hat{n}$) and the total electric field:
$$\\vec{B}(\\vec{r}, t) = \\frac{1}{c} \[\\hat{n} \\times \\vec{E}]\_{ret}$$

\---

## 3\. Software Architecture: The History Buffer

Because the LW equations require evaluating the position, velocity, and acceleration of a charge at $t\_{ret}$, **the engine must maintain a continuous history of every charge.** Unlike FDTD, which only knows the current state, an LW engine requires a `HistoryBuffer`.

### Implementation Skeleton (TypeScript/JavaScript)

Here is a robust skeleton for the History Buffer and Retarded Time solver. You can give this to Codex to bootstrap the core physics module.

```typescript
// types.ts
export interface Vector2 { x: number; y: number; }

export interface KinematicState {
    time: number;
    position: Vector2;
    velocity: Vector2;
    acceleration: Vector2;
}

export class ChargeHistory {
    public charge: number;
    private buffer: KinematicState\\\[] = \\\[];
    private maxHistoryTime: number; // e.g., how long it takes light to cross the screen

    constructor(charge: number, maxHistoryTime: number) {
        this.charge = charge;
        this.maxHistoryTime = maxHistoryTime;
    }

    // Called every simulation frame
    public recordState(state: KinematicState) {
        this.buffer.push(state);
        // Prune old history to prevent memory leaks
        while (this.buffer.length > 0 \\\&\\\& 
               (state.time - this.buffer\\\[0].time) > this.maxHistoryTime) {
            this.buffer.shift();
        }
    }

    // The most critical function: finding the state at t\\\_ret
    public getStateAtTime(targetTime: number): KinematicState {
        // Edge cases
        if (this.buffer.length === 0) return null;
        if (targetTime >= this.buffer\\\[this.buffer.length - 1].time) return this.buffer\\\[this.buffer.length - 1];
        if (targetTime <= this.buffer\\\[0].time) return this.buffer\\\[0];

        // Binary search to find the two surrounding frames
        let left = 0;
        let right = this.buffer.length - 1;
        while (left < right - 1) {
            const mid = Math.floor((left + right) / 2);
            if (this.buffer\\\[mid].time < targetTime) left = mid;
            else right = mid;
        }

        // Linear interpolation between the two frames
        const s1 = this.buffer\\\[left];
        const s2 = this.buffer\\\[right];
        const t = (targetTime - s1.time) / (s2.time - s1.time);

        return {
            time: targetTime,
            position: { x: s1.position.x + t \\\* (s2.position.x - s1.position.x), y: s1.position.y + t \\\* (s2.position.y - s1.position.y) },
            velocity: { x: s1.velocity.x + t \\\* (s2.velocity.x - s1.velocity.x), y: s1.velocity.y + t \\\* (s2.velocity.y - s1.velocity.y) },
            acceleration: { x: s1.acceleration.x + t \\\* (s2.acceleration.x - s1.acceleration.x), y: s1.acceleration.y + t \\\* (s2.acceleration.y - s1.acceleration.y) }
        };
    }
}
```

### The Root-Finding Algorithm

To calculate the field at pixel $(x,y)$, we must solve $t\_{ret} = t - R/c$. Because $R$ depends on the charge's position at $t\_{ret}$, this requires an iterative solver.

```typescript
// solver.ts
export function findRetardedState(
    targetPos: Vector2, 
    currentTime: number, 
    charge: ChargeHistory, 
    c: number
): KinematicState {
    
    // Initial guess: assume the charge hasn't moved (t\\\_ret = current\\\_time - distance/c)
    let currentState = charge.getStateAtTime(currentTime);
    let dist = Math.hypot(targetPos.x - currentState.position.x, targetPos.y - currentState.position.y);
    let t\\\_ret = currentTime - (dist / c);

    // Iterative refinement (usually converges in 2-3 iterations for non-relativistic speeds)
    for (let i = 0; i < 5; i++) {
        let guessState = charge.getStateAtTime(t\\\_ret);
        dist = Math.hypot(targetPos.x - guessState.position.x, targetPos.y - guessState.position.y);
        let new\\\_t\\\_ret = currentTime - (dist / c);
        
        if (Math.abs(new\\\_t\\\_ret - t\\\_ret) < 1e-4) {
            return guessState;
        }
        t\\\_ret = new\\\_t\\\_ret;
    }
    
    return charge.getStateAtTime(t\\\_ret);
}
```

## 4\. Execution Strategies: CPU vs. GPU

When building this new repository, you have two rendering paths.

### Path A: The Canvas 2D Vector Grid (Start Here)

* **How it works:** You iterate over a $40 \\times 40$ grid of points (like your FDTD arrows). For each point, you run the `findRetardedState` root-finder, plug it into the LW equations, and draw an arrow.
* **Pros:** Very easy to write in pure TypeScript. Easy to debug. You can perfectly reuse your `buildVectorBuckets` React code.
* **Cons:** The CPU has to run the root-finder $1600$ times per frame. It might struggle if you add dozens of charges.

### Path B: The WebGL Fragment Shader (The Final Form)

* **How it works:** You pass the `ChargeHistory` buffer into the GPU as a 1D Data Texture or a Uniform Array. You write a GLSL Fragment Shader that executes the root-finder and LW equations for every single pixel on the screen simultaneously.
* **Pros:** Capable of rendering pixel-perfect, continuous heatmaps of radiation pulses at 60+ FPS on a 4K screen.
* **Cons:** GLSL is harder to debug.

**Recommendation for the new repo:** Start with Path A (TypeScript). Get a single draggable charge generating a $40 \\times 40$ vector grid of radiation. Once you verify the math and the "feel" are correct, you can swap the rendering engine to WebGL without changing the UI architecture.

## 5\. Magnetic Field Decomposition and Wavefront Overlay (M6)

### A. Decomposing the Magnetic Field

The existing implementation exposes `bZ` (the total out-of-plane magnetic field) computed as:

$$B_z = \frac{1}{c} [\hat{n} \times \vec{E}]_z = \frac{\text{cross2D}(\hat{n},\, \vec{E}_{total})}{c}$$

Because $\vec{E}_{total} = \vec{E}_{vel} + \vec{E}_{accel}$ and the cross-product is linear, the magnetic field decomposes in exact parallel with the electric field:

$$B_z^{vel} = \frac{\text{cross2D}(\hat{n},\, \vec{E}_{vel})}{c}$$
$$B_z^{accel} = \frac{\text{cross2D}(\hat{n},\, \vec{E}_{accel})}{c}$$
$$B_z = B_z^{vel} + B_z^{accel}$$

This decomposition requires no new physics. It is a direct consequence of the linearity already present in the LW equations. The `LWFieldResult` type should be extended with `bZVel` and `bZAccel`; the existing `bZ` field remains unchanged for backward compatibility.

Physical interpretation:

- `bZVel` is the magnetic field associated with uniform or quasi-static motion. It is non-zero for a moving charge even when that charge is not accelerating.
- `bZAccel` is the magnetic field associated specifically with acceleration — the radiative magnetic component. It is identically zero for a stationary or uniformly moving charge.
- For the purposes of the wavefront overlay, `bZAccel` is the correct signal to display because it isolates the radiation structure. Using total `bZ` would mix in the non-radiative motion term and reduce the pedagogical clarity of the overlay.

### B. Warm-Start tRet Cache for the Scalar Sampler

The wavefront overlay samples `bZAccel` on a coarse scalar grid (approximately 96×54 to 128×72 cells) each frame. Each cell requires a retarded-time solve, which is the dominant per-sample cost.

**Core insight:** the retarded time at a fixed spatial sample point changes smoothly from frame to frame because the charge position evolves smoothly. The previous frame's solved `tRet` is therefore a much better initial guess than the solver's default bootstrap (which starts from the most recent history entry). Using it as the warm-start seed cuts average iteration count and reduces history-buffer binary-search churn.

**Implementation contract:**

Each scalar sample cell stores a `cachedTRet: number` alongside its position. On each frame, the retarded-time solver is seeded with that cached value instead of the default guess. After convergence, `cachedTRet` is updated with the new solved value.

The cache must be treated as invalid (reset to the default bootstrap) whenever any of the following change:

- camera bounds (sample lattice positions change in world space)
- scalar-grid resolution (different cell count or aspect ratio)
- speed of light `c` (changes the retarded-time relationship directly)
- simulation reseed or mode switch (history buffer is rebuilt from scratch)
- simulation epoch counter (used internally to signal any discontinuous history rebuild)

While paused, if none of the above have changed, the cache remains valid and the solver can reuse the same `tRet` values without re-solving — the sampled field is stable.

**Expected performance benefit:** for smooth wavefront motion (both `oscillating` and `moving_charge`), warm-starting is expected to require 1–2 iterations per cell on average vs. 4–6 from a cold start. At 96×54 ≈ 5000 cells this is a meaningful reduction in per-frame work and makes the feature viable in the CPU Path A architecture without requiring WebGL.

### C. Dynamic Range Compression for the Heatmap

The acceleration field $\vec{E}_{accel}$ (and therefore `bZAccel`) decays as $1/R$. A linear mapping from raw `bZAccel` to heatmap color or opacity will cause the near-source region to dominate the display while distant wavefronts fade below the visible threshold.

The rendering contract requires display-only dynamic-range compression:

- the sampled scalar retains its physically derived value (`bZAccel` in world units)
- the display step computes a contrast mapping based on per-frame field statistics (e.g., peak absolute value and RMS over the sampled grid)
- the color transfer is non-linear, following the same general strategy used in `wave-optics-sandbox` for signed and envelope heatmaps

This should be treated as a visualization rule, not a physics rewrite. The scalar field remains physically meaningful; only the pixel color mapping is shaped for legibility.

For `oscillating` mode the heatmap should use a signed color treatment (positive and negative `bZAccel` map to opposite hue directions) to make alternating phase fronts visible. For `moving_charge` mode the heatmap should use a single-polarity envelope treatment (`|bZAccel|`) to emphasize shell strength and extent without sign noise.

Radius-weighted remapping (e.g., multiplying by $R$ before the color transfer) may be explored in future iterations, but it is not the default v1 contract because it changes the visual meaning of contour levels and is harder to interpret pedagogically.

### D. Contour Extraction

Contours should be derived from the same sampled scalar buffer used for the heatmap — not from a separate physics solve. This ensures:

- heatmap and contours are always spatially aligned
- turning contours on adds only a rendering step, not a new field evaluation pass
- the two layers remain visually consistent under zoom, pan, and `c` changes

Contour extraction can be implemented as a lightweight marching-squares pass over the sampled buffer. The contour iso-values should be chosen to highlight the structure of interest: for `oscillating`, signed zero-crossings and amplitude peaks; for `moving_charge`, the envelope band that marks the radiation shell.

The full design rationale, UI model, supported modes, and acceptance criteria for M6 are documented in `IDEAS-wavefronts.md`.


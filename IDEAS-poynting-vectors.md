# IDEAS — Poynting Vector Visualization

## Context

The sandbox currently visualizes the electric field ($\vec{E}$) via vector arrows and the magnetic field ($B_z$) via a scalar heatmap. While this accurately represents the individual components of the Liénard-Wiechert fields, it stops short of the ultimate pedagogical punchline of classical electrodynamics: **physical energy transport**.

This document proposes adding a dedicated visualization for the **Poynting Vector** ($\vec{S}$), which represents the directional energy flux density of the electromagnetic field. 

Visualizing $\vec{S}$ transitions the sandbox from showing abstract "force fields" to showing exactly where and how physical energy is moving through space.

## The Math: Cheap in 2D, Not Literally Free

Implementing the Poynting vector requires **zero new retarded-time solvers**.
The sandbox already computes the quantities needed to derive it at each sample
point. However, the feature is not literally "free" in implementation terms:
it still needs UI design, dynamic-range handling, and careful pedagogical
positioning.

The definition of the Poynting vector is:
$$\vec{S} = \frac{1}{\mu_0} (\vec{E} \times \vec{B})$$

Because this sandbox operates in a 2D observation plane ($xy$-plane), the fields are strictly constrained:
- $\vec{E}$ exists entirely in the plane: $(E_x, E_y, 0)$
- $\vec{B}$ exists entirely out of the plane: $(0, 0, B_z)$

Taking the cross product of these vectors yields a Poynting vector that is strictly in the 2D canvas plane:
$$\vec{S}_{2D} \propto (E_y \cdot B_z, \; -E_x \cdot B_z)$$

**Implementation win:** To compute the Poynting vector arrows, take the
already-available `eTotal` and `bZ` values, rotate the in-plane electric field
by 90 degrees, and scale by `bZ`.

For this sandbox, the first version should be interpreted as:

- **instantaneous Poynting vector**
- in the sandbox's normalized units
- not a calibrated SI power-flux quantity
- not a time-averaged radiation intensity map

That distinction matters. In near fields, the instantaneous Poynting vector can
show local energy sloshing or circulation, not just clean outward radiation.

## The Visual Payoff: What the Student Sees

This visualization provides profound insights into energy transport across the three primary kinematic modes:

1. **Charge at Rest (Electrostatics vs Electrodynamics):**
   - The $\vec{E}$ field is a static Coulomb field, but $\vec{B} = 0$.
   - Therefore, $\vec{S} = 0$ (the arrows completely vanish).
   - *Pedagogical value:* Visually proves that a static Coulomb field contains energy, but does not *transport* it.
   
2. **Moving Charge (The Bound Field):**
   - $\vec{E}$ points radially away, but $\vec{B}$ wraps with the usual sign
     split. Their cross product produces an $\vec{S}$ pattern that is
     **predominantly forward**, aligned with the moving bound field.
   - *Pedagogical value:* The arrows can show that electromagnetic field energy
     is not only emitted as radiation; some of it is transported alongside the
     moving source configuration.

3. **Sudden Stop (The Radiation Shell):**
   - Inside the shell, the field becomes static ($\vec{S} = 0$, the arrows
     vanish).
   - On the shell itself, $\vec{E}$ and $\vec{B}$ are close to the clean
     radiative picture, so $\vec{S}$ points strongly outward.
   - *Pedagogical value:* The shell becomes the clearest visual argument that
     radiation is energy leaving the source region and propagating away.

4. **Oscillating / periodic sources:**
   - Far from the source, the arrows should read as outward energy flow.
   - Near the source, the pattern may be much more complicated: some energy
     flows outward, but some can circulate or reverse over the cycle.
   - *Pedagogical value:* This is valuable precisely because it separates
     "radiation escaping to infinity" from "reactive energy sloshing near the
     source."

## The Engineering Trap: The $1/r^4$ Dynamic Range

This is the single largest hurdle in implementing this feature. 

Because the Poynting vector is the product of two fields, its spatial decay is highly aggressive:
- In the **radiation shell**, $E \propto 1/r$ and $B \propto 1/r$, so the energy flow drops off as **$1/r^2$**.
- In the **bound near-field** (the moving charge bubble), $E \propto 1/r^2$ and $B \propto 1/r^2$, so the energy flow drops off as **$1/r^4$**.

**The Danger:** If $\vec{S}$ magnitude is mapped linearly to canvas arrow length, the $1/r^4$ near-field will completely blow out the scale. Arrows near a moving charge will be thousands of pixels long, forcing the normalization scale so high that the $1/r^2$ radiation shell becomes microscopically invisible.

**The solution:** The rendering layer must apply a highly aggressive,
non-linear compression function to arrow magnitude for this mode.
Using a fractional power or logarithmic scale allows both the near-field drag
and the far-field radiation region to remain visible simultaneously.

Example shaping:

`arrowLength = Math.pow(mag, 0.25) * scaleFactor`

That alone may not be sufficient. A first implementation should also be allowed
to:

- impose a hard world-space cap on arrow length
- fade or suppress arrows inside a small radius around each charge
- bias the arrow alpha curve more gently than the length curve

Near-charge suppression is not a physics statement; it is a rendering hygiene
decision to prevent the local singular structure from destroying the rest of
the view.

## Architectural & UI Implications

1. **Depends on full B first:** This should only be attempted after the full
   magnetic-field implementation is complete. Once students can already inspect
   `Total B / Velocity B / Accel B`, the Poynting vector becomes a natural
   derived quantity rather than a surprise new abstraction.
2. **Mutually exclusive field arrows:** Drawing $\vec{S}$ arrows on top of
   $\vec{E}$ arrows would be visually unreadable. `Poynting S` should be added
   as a mutually exclusive option in the existing vector-field selector rather
   than as a simultaneous overlay.
3. **First version should be single-channel only:** The first implementation
   should be exactly one option: `Poynting S` derived from `eTotal × bZ`.
   Do **not** introduce `Velocity S` or `Accel S` initially. Unlike the clean
   `E` and `B` decomposition, the Poynting vector contains cross-terms, and a
   naive component split would be pedagogically messy.
4. **Heatmap compatibility:** The Poynting arrows should remain compatible with
   the existing magnetic heatmap channel and the radiation contour overlay.
   They should not require a dedicated heatmap.
5. **Color palette:** Give the Poynting arrows a distinct palette from the
   electric field arrows, but stay within the field-sandbox family. A gold or
   green-gold range is a plausible starting point.
6. **Live vs paused:** The first version can run live because it reuses the
   same sampled field result already needed by `VectorFieldCanvas`. However, if
   the display becomes too unstable or noisy during motion, a paused-only or
   reduced-density fallback is acceptable for the first milestone.

## Recommended Milestone Placement

This is a **post-full-B feature**, not the next milestone.

The right sequencing is:

1. finish the broader magnetic-field story (`Total B / Velocity B / Accel B`)
2. let students inspect `E` and `B` directly
3. then add `Poynting S` as the energy-flow quantity derived from those fields

That order is pedagogically cleaner and reduces implementation ambiguity. By
the time `Poynting S` is introduced, the app already has the necessary magnetic
channel, UI vocabulary, and user mental model.

## Recommended first-scope definition

When this is eventually implemented, the initial scope should be:

- one new vector-field mode: `Poynting S`
- computed from `eTotal` and `bZ`
- displayed as arrow direction plus aggressively compressed magnitude
- compatible with all existing demo modes
- explicitly documented as **instantaneous** energy flow, not time-averaged
  radiated power

Everything beyond that should be deferred until the first version has been
visually validated.

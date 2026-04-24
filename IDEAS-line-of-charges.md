# IDEAS — Line of Charges (Particle Beam & Neutral Wire)

## Context

The sandbox currently excels at visualizing the Liénard-Wiechert fields of a
single point charge or a small structured source such as a dipole. A natural
future direction is to bridge the gap between microscopic point charges and
macroscopic classical electromagnetism such as currents, magnetic fields around
wires, and causal updates to those fields.

This document proposes a multi-charge expansion that arranges discrete charges
in a line. The central teaching goal is to show how individual particle fields
superimpose into current-like macroscopic behavior.

To avoid teaching the wrong lesson, this feature should be split into distinct
pedagogical phases rather than introduced as one ambiguous "wire" mode.

## Recommended sequence

If this idea is implemented, the recommended order is:

1. **Particle Beam**
2. **Neutral Wire**
3. **Neutral Wire — Stop Now**
4. **Neutral Wire — AC / driven oscillation** (later, separate milestone)

This order matters. The first two modes teach superposition and magnetic-field
formation. The third teaches finite-speed causal updates. The fourth crosses
into antenna-like and driven-source behavior and should not be folded into the
first implementation.

This feature should also come **after the full B-field implementation**. The
main payoff of a line-of-charges demo is the magnetic-field structure, not the
radiation heatmap.

## Phase 1: The Particle Beam

The simplest implementation is a line of $N$ like-signed charges moving
together at constant velocity.

Example starting geometry:

- $N = 5$ to $9$ charges
- equal spacing along one axis
- all charges share the same sign
- all charges move with the same constant velocity

### Physics picture

- **Electric field ($E$):** the radial electric fields of the charges add,
  producing a large external electric field around the beam.
- **Magnetic field ($B$):** the magnetic contributions superimpose into a
  current-like banded structure around the moving line of charge.

### Pedagogical value

This is **not** a neutral wire. It is a charged particle beam.

That distinction is the whole point of the mode:

- it teaches field superposition directly
- it shows that a moving distribution of charge can create a macroscopic
  magnetic pattern
- it also shows why a beam is not the same thing as an ordinary current-carrying
  conductor, because the large external electric field remains

### Implementation guidance

- This mode should be described explicitly in UI text as a **particle beam**,
  not a wire.
- The first rendering emphasis should be:
  - `Total E`
  - `Velocity B`
  - `Total B`
- Heatmap/radiation support is optional for the first pass.

## Phase 2: The Neutral Wire Approximation

To simulate something closer to an ordinary current-carrying conductor, the
system should approximate **electrical neutrality** by combining:

- a stationary positive lattice
- a symmetrically split moving negative current

### Physics picture

The intended source model is:

- $N$ stationary positive charges arranged in a line on the center axis
- two moving negative streams, each carrying half the compensating negative
  charge, one just above and one just below the center axis

This is best thought of as a **finite-width neutral-wire approximation**, not a
literal zero-width wire.

### Critical caveat

For a **finite discrete line**, the external electric field does **not** cancel
exactly everywhere. There will be:

- end effects
- local lattice-scale structure
- residual non-cancellation away from the idealized center region

So this mode should be described as a **neutral-wire approximation**, not as an
exact infinite-wire solution.

The right pedagogical claim is:

- far from the microscopic lattice scale, and away from the ends, the external
  electric field can be made small compared with the magnetic field
- the magnetic field remains macroscopically visible because it is produced by
  the moving charges

### Geometry decision: use a symmetric transverse split

The first implementation should **not** use exact longitudinal crossings
between the moving negative charges and the stationary positive ions. Even with
softening to prevent singular blowups, those crossings would create violent
local field spikes and visible strobing that overwhelms the macroscopic current
story.

It also should **not** use a single off-axis negative stream. That would create
a large built-in transverse dipole moment and produce the wrong large-scale
electric field.

The preferred first geometry is:

- one stationary positive lattice on the center axis
- one moving negative stream at `+epsilon`
- one moving negative stream at `-epsilon`
- each moving negative stream carries half the compensating charge

This **symmetric transverse split** preserves steady current-like flow, avoids
exact collision spikes, and suppresses the gross macroscopic dipole error of a
single transverse offset.

It does **not** perfectly cancel the external electric field everywhere. The
claim remains approximate:

- in the middle region, the macroscopic external `E` can be made small compared
  with the magnetic field
- end effects and finite-width structure still remain visible

### Pedagogical value

This mode would provide a strong bridge to Ampere-style intuition:

- why a current-carrying wire has a visible magnetic field
- why its external electric field can be comparatively small
- how a macroscopic field pattern emerges from microscopic superposition

## Phase 3: Neutral Wire — Stop Now

This is the strongest extension after the static/steady neutral-wire mode.

The idea:

- begin with the neutral-wire approximation in steady motion
- then abruptly stop the moving negative charges
- leave the positive lattice fixed

### Pedagogical value

This would be an excellent causality demo:

- the magnetic field does not disappear everywhere at once
- the information that the current has stopped propagates outward at finite
  speed
- the external field pattern updates shell-by-shell, just as in the single
  `moving_charge` stop demo

This is exactly the sort of finite-speed field-update story that this sandbox
is already good at.

### Important visible consequence

After the radiation shell passes, the remaining field may not be a perfectly
featureless "wire with no field." The stopped negative charges will generally
remain in a fixed microscopic arrangement relative to the positive lattice, so
the final state may reveal a static lattice-scale Coulomb structure.

That is not a bug. It is a useful contrast:

- the smooth macroscopic magnetic/current pattern propagates away
- the residual microscopic charge structure remains behind as a static field

### Scope note

This should be framed as an idealized many-charge Liénard-Wiechert thought
experiment, not as a complete microscopic model of a real conducting wire.

## Phase 4: Neutral Wire — AC / Driven Current

An AC or periodically driven neutral-wire mode could also be valuable, but it
should be treated as a later and separate milestone.

Why it is interesting:

- it introduces a line source with time-varying current
- it could show a transition from bound/current-like fields to genuine
  radiation
- it creates a direct bridge toward antenna intuition

Why it is dangerous:

- it is easy to over-claim the physical realism
- finite line length vs. wavelength starts to matter
- the source model becomes more subtle: charge density, phase, and endpoint
  behavior all matter
- it risks becoming an antenna / driven-source milestone rather than a simple
  wire demo

So the right framing is:

- worthwhile future direction
- not part of the first line-of-charges implementation

## Technical implementation considerations

### 1. Multi-charge scaling

This feature requires more active charges than the current dipole / hydrogen
setup. That affects both CPU and WebGL paths.

The key scaling fact is:

- **vector-field / streamline work** scales roughly linearly with charge count
  and remains the more realistic first target
- **WebGL heatmap work** also scales roughly linearly with charge count, but
  per-pixel retarded-time solves make it much more expensive

So the recommended first implementation should prioritize:

- vector arrows
- cursor readout
- optional CPU-sampled overlays if needed

and treat full multi-charge WebGL heatmaps as a second step.

### 2. WebGL bottleneck

The current WebGL renderer has hardcoded assumptions sized for a very small
number of charges. Increasing to $N = 5$ to $10$ charges would require:

- larger or differently packed history textures
- higher `MAX_CHARGES`
- per-charge retarded-time solves in the fragment shader
- more careful performance validation on lower-end hardware

This is not just a constant tweak. It is a real renderer-scaling milestone.

### 3. Boundary choice

A later implementation must make an explicit decision about source boundaries:

- **finite segment** with real end effects
- **wrapped / periodic** line to suppress end effects

For a first implementation, a **finite segment** is acceptable and easier to
explain, as long as the end effects are explicitly acknowledged in the UI/docs.

## Edge effects: what to do with them

Finite-length edge effects are not just a nuisance here; they are one of the
main design decisions of the mode.

### Why edge effects are good

- They are physically honest for a finite segment of moving charges.
- They help distinguish a **finite beam / finite wire approximation** from the
  idealized infinite-wire picture from textbooks.
- They create a natural teaching contrast between the middle of the line
  ("bulk-like" behavior) and the ends ("finite-source" behavior).

### Why edge effects are bad

- They can make the source harder to read as "wire-like" at first glance.
- They can interfere with the student's attempt to identify the clean central
  magnetic structure.
- In the neutral-wire approximation, they make the external electric-field
  cancellation visibly worse near the ends, which can be confusing if the mode
  is over-described as "a wire with no external E-field."

### Recommended handling for the first implementation

Do **not** try to numerically hide or remove the edge effects in the first
version. Instead:

- make the finite geometry explicit in the mode description
- choose a line long enough that the middle region reads clearly
- center the default camera on the middle of the line, not the full segment
- if needed, add a very subtle visual cue marking the "bulk region" where the
  wire-like interpretation is most valid

That gives the student the right first impression without pretending the source
is infinite.

### Recommended language

For the neutral-wire approximation, the UI/docs should say something like:

- "In the middle of the segment, the external electric field is reduced by
  approximate charge cancellation while the magnetic field remains visible."

That is much safer than saying:

- "The external electric field is zero."

### Periodic boundary conditions: later possibility

A later extension could introduce a separate mode or option representing a
**periodic wire approximation**, where the charge pattern wraps and the line has
no ends.

Potential benefits:

- strongly suppresses edge effects
- produces a cleaner "infinite-wire-like" central field pattern
- better isolates the magnetic/current structure

Potential drawbacks:

- less intuitive than a finite segment
- easier for students to misunderstand unless explained carefully
- a different physical idealization, not just a rendering optimization

So periodic boundary conditions are worth preserving as a future idea, but they
should not be folded into the first implementation. The first version should
remain a finite segment with acknowledged end effects.

## Recommended first implementation scope

If this idea is eventually promoted into active work, the cleanest first scope
would be:

### Milestone A: Particle Beam

- finite line of like-signed moving charges
- vector-field rendering only
- strong emphasis on `Velocity B` / `Total B`
- no attempt to sell it as a neutral wire

### Milestone B: Neutral Wire Approximation

- stationary positive lattice + symmetric transverse split negative streams
- vector-field rendering first
- UI/docs explicitly note approximate external-$E$ cancellation and end effects

### Milestone C: Neutral Wire Stop Now

- current-like source turns off causally
- emphasizes delayed collapse of the magnetic field

Only after those are stable should a line-of-charges WebGL heatmap expansion be
considered.

## Where this belongs in project scope

This is a **future direction**, not an active milestone.

It should sit **after**:

1. full B-field visualization
2. likely after the first Poynting-vector / energy-flow work, if that is done
   first

because the main value of a line-of-charges source is in the magnetic/current
story, not in raw source-count scaling by itself.

## Summary

The line-of-charges idea is strong, but it must be implemented carefully.

The correct progression is:

- first show a **particle beam**, where both $E$ and $B$ are large and visible
- then show a **neutral-wire approximation**, where external $E$ is reduced but
  $B$ survives
- then optionally show **causal shutdown** with `Stop now`
- only later explore **AC / driven current**

The biggest risks are:

- letting students confuse a charged beam with a neutral wire
- overstating exact electric-field cancellation for a finite discrete line
- walking into unnecessary WebGL scaling work before the B-field story is
  complete

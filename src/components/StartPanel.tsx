// StartPanel — home screen overlay shown on initial load and after Reset.
//
// Pure presentation component. Dismisses itself by calling onSelectMode,
// which the parent maps to handleDemoModeChange. No simulation knowledge here.
//
// Visual style: matches field-sandbox ElectricFieldSandbox.tsx start overlay —
// dark glass card, backdrop-blur-md, centered in the viewport — adapted to the
// orange theming of this sandbox rather than cyan.

import type { DemoMode } from '@/physics/demoModes';

type Props = {
  onSelectMode: (mode: DemoMode) => void;
};

type ModeCard = {
  mode: DemoMode;
  title: string;
  desc: string;
  hint: string;
};

const MODE_CARDS: ModeCard[] = [
  {
    mode: 'draggable',
    title: 'Charge at rest',
    desc: 'Drag the charge to shake the field and launch radiation pulses.',
    hint: 'Try switching to Accel E to isolate the radiation term. Fast jerks vs. slow drags produce very different pulse shapes.',
  },
  {
    mode: 'moving_charge',
    title: 'Moving charge',
    desc: 'A charge moves at constant velocity until you click Stop — launching a radiation shell that expands at c.',
    hint: 'Inside the shell is the at-rest field; outside is the moving-charge field. Lower c to make the difference extreme.',
  },
  {
    mode: 'oscillating',
    title: 'Oscillating',
    desc: 'Continuous sinusoidal acceleration radiates outward as an expanding wave train.',
    hint: 'Enable the Radiation heatmap and Wavefront contours. Lower c so the fronts slow down and separate clearly.',
  },
  {
    mode: 'dipole',
    title: 'Dipole',
    desc: 'Two opposite charges oscillate in antiphase. Their combined field shows the classic dipole radiation pattern.',
    hint: 'Enable the Radiation heatmap to see the characteristic lobed pattern — radiation is strongest perpendicular to the dipole axis.',
  },
  {
    mode: 'hydrogen',
    title: 'Hydrogen atom',
    desc: 'A negative charge follows a circular orbit around a fixed positive center, creating a rotating dipole source.',
    hint: 'Turn on the Radiation heatmap and contours to watch the signed magnetic radiation pattern rotate outward.',
  },
];

export function StartPanel({ onSelectMode }: Props) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-6">
      <div className="pointer-events-auto w-full max-w-5xl select-none rounded-3xl border border-orange-400/20 bg-black/65 px-8 py-7 text-center shadow-[0_0_48px_rgba(251,146,60,0.1)] backdrop-blur-md">

        {/* Header */}
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-orange-200/70">
          Charge Radiation Sandbox
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-white">
          Watch electromagnetic radiation emerge from an accelerating charge.
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-300/85">
          The field is computed from the exact Liénard-Wiechert formula. It is retarded — what
          you see at any point reflects where the charge{' '}
          <span className="text-zinc-100">was</span> when the light left, not where it is now.
        </p>

        {/* Concept cards */}
        <div className="mt-4 grid gap-3 text-left text-sm sm:grid-cols-2">
          <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
            <p className="font-medium text-cyan-200">Velocity field (Ev)</p>
            <p className="mt-1 leading-6 text-zinc-300/85">
              The bound Coulomb-like field, modified by motion. Falls off as 1/r² and stays
              attached to the source — not radiation.
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
            <p className="font-medium text-amber-200">Radiation field (Ea)</p>
            <p className="mt-1 leading-6 text-zinc-300/85">
              Created by acceleration. Falls off as 1/r, so it dominates at large distances.
              Once emitted it detaches and propagates as a wave.
            </p>
          </div>
        </div>

        {/* Mode selection */}
        <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">
          Choose a mode to begin
        </p>
        <div className="mt-2 grid gap-2.5 text-left text-sm sm:grid-cols-2 lg:grid-cols-3">
          {MODE_CARDS.map(({ mode, title, desc, hint }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSelectMode(mode)}
              className="rounded-2xl border border-orange-400/[0.18] bg-orange-400/[0.07] px-4 py-3 text-left transition-all duration-200 hover:border-orange-400/40 hover:bg-orange-400/[0.15] hover:shadow-[0_0_16px_rgba(251,146,60,0.15)] active:scale-[0.98]"
            >
              <p className="font-medium text-orange-100">{title}</p>
              <p className="mt-1 text-[12px] leading-5 text-zinc-300/80">{desc}</p>
              <p className="mt-2 text-[11px] leading-5 text-zinc-400/75">{hint}</p>
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}

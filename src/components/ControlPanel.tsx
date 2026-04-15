// ControlPanel — floating glass panel for mode and field-layer controls.
//
// Pure presentation component. No simulation state, no physics knowledge.
//
// Visual style matches field-sandbox (FieldSandboxControlPanel.tsx):
// rounded-2xl panel, zinc-400 section labels, tinted-bg inactive buttons,
// solid-bg + black text + glow active buttons, text-sm throughout.
// All styling via Tailwind — no inline CSSProperties.

import type { DemoMode } from '@/physics/demoModes';
import type { CursorReadout } from './useCursorReadout';

type FieldLayer = 'total' | 'vel' | 'accel';

type Props = {
  demoMode: DemoMode;
  fieldLayer: FieldLayer;
  isPaused: boolean;
  c: number;
  stopTriggered: boolean;
  readout: CursorReadout;
  showRadiationHeatmap: boolean;
  showWavefrontContours: boolean;
  showStreamlines: boolean;
  onDemoModeChange: (mode: DemoMode) => void;
  onFieldLayerChange: (layer: FieldLayer) => void;
  onPauseToggle: () => void;
  onStepForward: () => void;
  onReset: () => void;
  onCChange: (c: number) => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onPanUp: () => void;
  onPanDown: () => void;
  onRadiationHeatmapToggle: () => void;
  onWavefrontContoursToggle: () => void;
  onStreamlinesToggle: () => void;
  /**
   * When true, the Wavefront contours toggle is visually disabled (greyed out)
   * and ignores clicks. Used during M7 when the WebGL path is active in
   * moving_charge mode — the envelope contour is deferred to M8.
   */
  contoursDisabled?: boolean;
  /**
   * Lower bound for the c slider. Defaults to 0.65.
   * Set to minCForMode(demoMode) when the WebGL path is active so the
   * slider UI matches the M7 c-min policy enforced in handleCChange.
   */
  cMin?: number;
  /**
   * When true, no mode button is shown as active. Used while the start panel
   * is visible — the user has not yet chosen a mode for this session.
   */
  noModeActive?: boolean;
};

// Shared base classes for all mode/field toggle buttons.
const TOGGLE_BASE = 'rounded-md px-3 py-2 text-sm font-medium transition-all duration-200';

// Shared base classes for icon buttons (zoom ±, pan arrows).
const ICON_BASE = 'flex h-7 w-7 items-center justify-center rounded-md text-sm text-white/85 bg-white/[0.12] hover:bg-white/20 transition-colors duration-200';

export function ControlPanel({
  demoMode, fieldLayer, isPaused, c, stopTriggered, readout,
  showRadiationHeatmap, showWavefrontContours, showStreamlines,
  onDemoModeChange, onFieldLayerChange,
  onPauseToggle, onStepForward, onReset,
  onCChange,
  onResetView, onZoomIn, onZoomOut,
  onPanLeft, onPanRight, onPanUp, onPanDown,
  onRadiationHeatmapToggle, onWavefrontContoursToggle, onStreamlinesToggle,
  contoursDisabled = false,
  cMin = 0.65,
  noModeActive = false,
}: Props) {
  return (
    <div className="absolute left-4 top-4 z-20 flex flex-col gap-3 rounded-2xl border border-orange-400/20 bg-black/65 p-4 text-sm text-zinc-200 backdrop-blur-md select-none pointer-events-auto">

      {/* Mode */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Mode</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onDemoModeChange('draggable')}
            className={`${TOGGLE_BASE} ${!noModeActive && demoMode === 'draggable'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Charge at Rest
          </button>
          <button type="button" onClick={() => onDemoModeChange('moving_charge')}
            className={`${TOGGLE_BASE} ${!noModeActive && demoMode === 'moving_charge'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Moving charge
          </button>
          <button type="button" onClick={() => onDemoModeChange('oscillating')}
            className={`${TOGGLE_BASE} ${!noModeActive && demoMode === 'oscillating'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Oscillating
          </button>
        </div>
        {demoMode === 'draggable' && (
          <p className="mt-1.5 text-[11px] text-zinc-400">
            {isPaused
              ? 'Click Run, then drag the charge to create radiation pulses.'
              : 'Drag the charge to create radiation pulses.'}
          </p>
        )}
        {demoMode === 'moving_charge' && (
          <p className="mt-1.5 text-[11px] text-zinc-400">
            {stopTriggered
              ? 'The charge has stopped. The shell separates the old moving field from the new at-rest field.'
              : 'A charge moves at constant velocity. Click Stop now to launch a radiation shell.'}
          </p>
        )}
        {demoMode === 'oscillating' && (
          <p className="mt-1.5 text-[11px] text-zinc-400">The charge oscillates sinusoidally. Continuous dipole radiation propagates outward.</p>
        )}
      </div>

      {/* Playback */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Playback</p>
        <div className="flex gap-1.5">
          <button type="button" onClick={onPauseToggle}
            className={`${TOGGLE_BASE} ${isPaused
              ? 'bg-indigo-300 text-black shadow-[0_0_16px_rgba(165,180,252,0.45)]'
              : 'bg-indigo-400/20 text-indigo-200 hover:bg-indigo-400/35'}`}>
            {isPaused ? 'Run' : 'Pause'}
          </button>
          <button type="button" onClick={onStepForward}
            className="rounded-md px-3 py-2 text-sm font-medium bg-zinc-200/20 text-zinc-200 hover:bg-zinc-200/32 transition-colors duration-200">
            Step →
          </button>
          <button type="button" onClick={onReset}
            className="rounded-md px-3 py-2 text-sm font-medium bg-zinc-200/20 text-zinc-200 hover:bg-zinc-200/32 transition-colors duration-200">
            Reset
          </button>
        </div>
      </div>

      {/* Speed of light */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">
          Speed of light — c = {c.toFixed(2)}
        </p>
        <input
          type="range"
          min={cMin}
          max={3.0}
          step={0.05}
          value={c}
          onChange={e => onCChange(parseFloat(e.target.value))}
          className="w-full accent-orange-400"
        />
      </div>

      {/* Field layer */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Field</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onFieldLayerChange('total')}
            className={`${TOGGLE_BASE} ${fieldLayer === 'total'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Total E
          </button>
          <button type="button" onClick={() => onFieldLayerChange('vel')}
            className={`${TOGGLE_BASE} ${fieldLayer === 'vel'
              ? 'bg-cyan-300 text-black shadow-[0_0_16px_rgba(94,220,255,0.45)]'
              : 'bg-cyan-400/20 text-cyan-200 hover:bg-cyan-400/35'}`}>
            Velocity E
          </button>
          <button type="button" onClick={() => onFieldLayerChange('accel')}
            className={`${TOGGLE_BASE} ${fieldLayer === 'accel'
              ? 'bg-amber-300 text-black shadow-[0_0_16px_rgba(251,191,36,0.45)]'
              : 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/35'}`}>
            Accel E
          </button>
        </div>
      </div>

      {/* Teaching Overlays */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Overlays</p>
        <div className="flex flex-wrap gap-1.5">
          {/* M9: field-line overlay — available in all modes when paused */}
          <button type="button" onClick={onStreamlinesToggle}
            className={`${TOGGLE_BASE} ${showStreamlines
              ? 'bg-sky-400/90 text-black shadow-[0_0_12px_rgba(56,189,248,0.4)]'
              : 'bg-sky-400/15 text-sky-200 hover:bg-sky-400/28'}`}>
            Field lines
          </button>
          {/* M6 radiation overlays — moving_charge and oscillating only */}
          {(demoMode === 'moving_charge' || demoMode === 'oscillating') && (<>
            <button type="button" onClick={onRadiationHeatmapToggle}
              className={`${TOGGLE_BASE} ${showRadiationHeatmap
                ? 'bg-amber-400/90 text-black shadow-[0_0_12px_rgba(251,191,36,0.4)]'
                : 'bg-amber-400/15 text-amber-200 hover:bg-amber-400/28'}`}>
              Radiation heatmap
            </button>
            <button
              type="button"
              onClick={contoursDisabled ? undefined : onWavefrontContoursToggle}
              title={contoursDisabled ? 'Contour lines available in a future update' : undefined}
              className={`${TOGGLE_BASE} ${
                contoursDisabled
                  ? 'opacity-35 cursor-not-allowed bg-violet-400/10 text-violet-400/50'
                  : showWavefrontContours
                    ? 'bg-violet-400/90 text-black shadow-[0_0_12px_rgba(192,132,250,0.4)]'
                    : 'bg-violet-400/15 text-violet-200 hover:bg-violet-400/28'
              }`}>
              Wavefront contours
            </button>
          </>)}
        </div>
        {showStreamlines && isPaused && (
          <p className="mt-1.5 text-[11px] text-zinc-400">
            Instantaneous snapshot — not material lines that move with the charge.
          </p>
        )}
        {showStreamlines && !isPaused && (
          <p className="mt-1.5 text-[11px] text-zinc-400">
            Pause to show field lines.
          </p>
        )}
      </div>

      {/* Camera */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Camera</p>
        <div className="flex flex-col items-start gap-1.5">
          <button type="button" onClick={onResetView}
            className="rounded-md px-3 py-2 text-sm font-medium bg-zinc-200/20 text-zinc-200 hover:bg-zinc-200/32 transition-colors duration-200">
            Reset view
          </button>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onZoomOut} className={ICON_BASE}>−</button>
            <span className="text-[11px] text-zinc-500">zoom</span>
            <button type="button" onClick={onZoomIn} className={ICON_BASE}>+</button>
          </div>
          {/* Pan arrow pad — 3×3 grid, center cell empty */}
          <div className="grid gap-0.5 [grid-template-columns:repeat(3,1.75rem)] [grid-template-rows:repeat(3,1.75rem)]">
            <span /><button type="button" onClick={onPanUp} className={ICON_BASE}>↑</button><span />
            <button type="button" onClick={onPanLeft} className={ICON_BASE}>←</button>
            <span />
            <button type="button" onClick={onPanRight} className={ICON_BASE}>→</button>
            <span /><button type="button" onClick={onPanDown} className={ICON_BASE}>↓</button><span />
          </div>
        </div>
      </div>

      {/* Cursor readout */}
      {readout !== null && (
        <div className="border-t border-white/10 pt-2">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Field at cursor</p>
          <div className="font-mono text-[12px] text-zinc-300 space-y-0.5">
            <div>|E|&nbsp;&nbsp;<span className="text-white">{readout.eTotal.toFixed(3)}</span></div>
            <div>Ev&nbsp;&nbsp;<span className="text-cyan-300">{readout.eVel.toFixed(3)}</span></div>
            <div>Ea&nbsp;&nbsp;<span className="text-amber-300">{readout.eAccel.toFixed(3)}</span></div>
            <div>Bz&nbsp;&nbsp;<span className="text-violet-300">{readout.bZ.toFixed(3)}</span></div>
          </div>
        </div>
      )}

    </div>
  );
}

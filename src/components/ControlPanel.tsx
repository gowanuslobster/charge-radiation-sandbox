// ControlPanel — floating glass panel for mode and field-layer controls.
//
// Pure presentation component. No simulation state, no physics knowledge.
//
// Visual style matches field-sandbox (FieldSandboxControlPanel.tsx):
// rounded-2xl panel, zinc-400 section labels, tinted-bg inactive buttons,
// solid-bg + black text + glow active buttons, text-sm throughout.
// All styling via Tailwind — no inline CSSProperties.

import type { DemoMode } from '@/physics/demoModes';
type FieldLayer = 'total' | 'vel' | 'accel';

type Props = {
  demoMode: DemoMode;
  fieldLayer: FieldLayer;
  isPaused: boolean;
  onDemoModeChange: (mode: DemoMode) => void;
  onFieldLayerChange: (layer: FieldLayer) => void;
  onPauseToggle: () => void;
  onStepForward: () => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onPanUp: () => void;
  onPanDown: () => void;
};

// Shared base classes for all mode/field toggle buttons.
const TOGGLE_BASE = 'rounded-md px-3 py-2 text-sm font-medium transition-all duration-200';

// Shared base classes for icon buttons (zoom ±, pan arrows).
const ICON_BASE = 'flex h-7 w-7 items-center justify-center rounded-md text-sm text-white/85 bg-white/[0.12] hover:bg-white/20 transition-colors duration-200';

export function ControlPanel({
  demoMode, fieldLayer, isPaused,
  onDemoModeChange, onFieldLayerChange,
  onPauseToggle, onStepForward,
  onResetView, onZoomIn, onZoomOut,
  onPanLeft, onPanRight, onPanUp, onPanDown,
}: Props) {
  return (
    <div className="absolute left-4 top-4 z-20 flex flex-col gap-3 rounded-2xl border border-orange-400/20 bg-black/65 p-4 text-sm text-zinc-200 backdrop-blur-md select-none pointer-events-auto">

      {/* Mode */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Mode</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onDemoModeChange('stationary')}
            className={`${TOGGLE_BASE} ${demoMode === 'stationary'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Stationary
          </button>
          <button type="button" onClick={() => onDemoModeChange('uniform_velocity')}
            className={`${TOGGLE_BASE} ${demoMode === 'uniform_velocity'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Uniform velocity
          </button>
          <button type="button" onClick={() => onDemoModeChange('sudden_stop')}
            className={`${TOGGLE_BASE} ${demoMode === 'sudden_stop'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Sudden stop
          </button>
          <button type="button" onClick={() => onDemoModeChange('draggable')}
            className={`${TOGGLE_BASE} ${demoMode === 'draggable'
              ? 'bg-orange-400 text-black shadow-[0_0_16px_rgba(251,146,60,0.5)]'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/35'}`}>
            Draggable
          </button>
        </div>
      </div>

      {/* Playback */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">Playback</p>
        <div className="flex gap-1.5">
          <button type="button" onClick={onPauseToggle}
            className={`${TOGGLE_BASE} ${isPaused
              ? 'bg-indigo-300 text-black shadow-[0_0_16px_rgba(165,180,252,0.45)]'
              : 'bg-indigo-400/20 text-indigo-200 hover:bg-indigo-400/35'}`}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={onStepForward}
            className="rounded-md px-3 py-2 text-sm font-medium bg-zinc-200/20 text-zinc-200 hover:bg-zinc-200/32 transition-colors duration-200">
            Step →
          </button>
        </div>
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

    </div>
  );
}

// ControlPanel — floating glass panel for mode and field-layer controls.
//
// Pure presentation component. No simulation state, no physics knowledge.
//
// Visual style matches field-sandbox: rounded-2xl panel, zinc-400 section labels,
// tinted-bg inactive buttons, solid-bg + black text + glow active buttons, text-sm (14px).

import type { CSSProperties } from 'react';
import type { DemoMode } from '../physics/demoModes';
type FieldLayer = 'total' | 'vel' | 'accel';

type Props = {
  demoMode: DemoMode;
  fieldLayer: FieldLayer;
  onDemoModeChange: (mode: DemoMode) => void;
  onFieldLayerChange: (layer: FieldLayer) => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onPanUp: () => void;
  onPanDown: () => void;
};

const PANEL_STYLE: CSSProperties = {
  position: 'absolute',
  top: '1rem',
  left: '1rem',
  background: 'rgba(0,0,0,0.65)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,140,60,0.2)',
  borderRadius: '16px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  color: '#e4e4e7',
  fontSize: '14px',
  userSelect: 'none',
  pointerEvents: 'auto',
};

// Matches field-sandbox: text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400
const LABEL_STYLE: CSSProperties = {
  fontWeight: 500,
  marginBottom: '6px',
  color: '#a1a1aa',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
};

const BTN_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexWrap: 'wrap',
};

// Neutral icon buttons (zoom ±, pan arrows): subtle tinted bg, bright text, no border.
// Matches field-sandbox zoom-out / reset-view style: bg-zinc-200/20 text-zinc-200.
const ICON_BTN_STYLE: CSSProperties = {
  width: '28px',
  height: '28px',
  borderRadius: '6px',
  border: 'none',
  background: 'rgba(255,255,255,0.12)',
  color: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 500,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s',
};

/**
 * Button style matching field-sandbox:
 *   inactive — tinted bg at ~18% opacity, color as text, no border
 *   active   — solid bright bg, black text, glow shadow
 */
function btn(active: boolean, color: string): CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    background: active ? color : `${color}2e`,
    color: active ? '#000' : color,
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'all 0.2s',
    boxShadow: active ? `0 0 16px ${color}70` : 'none',
  };
}

export function ControlPanel({
  demoMode, fieldLayer,
  onDemoModeChange, onFieldLayerChange,
  onResetView, onZoomIn, onZoomOut,
  onPanLeft, onPanRight, onPanUp, onPanDown,
}: Props) {
  return (
    <div style={PANEL_STYLE}>
      <div>
        <div style={LABEL_STYLE}>Mode</div>
        <div style={BTN_ROW_STYLE}>
          <button style={btn(demoMode === 'stationary', '#ff9050')}
            onClick={() => onDemoModeChange('stationary')}>
            Stationary
          </button>
          <button style={btn(demoMode === 'uniform_velocity', '#ff9050')}
            onClick={() => onDemoModeChange('uniform_velocity')}>
            Uniform velocity
          </button>
          <button style={btn(demoMode === 'sudden_stop', '#ff9050')}
            onClick={() => onDemoModeChange('sudden_stop')}>
            Sudden stop
          </button>
        </div>
      </div>
      <div>
        <div style={LABEL_STYLE}>Field</div>
        <div style={BTN_ROW_STYLE}>
          <button style={btn(fieldLayer === 'total', '#ff9050')}
            onClick={() => onFieldLayerChange('total')}>
            Total E
          </button>
          <button style={btn(fieldLayer === 'vel', '#50c8ff')}
            onClick={() => onFieldLayerChange('vel')}>
            Velocity E
          </button>
          <button style={btn(fieldLayer === 'accel', '#ffd050')}
            onClick={() => onFieldLayerChange('accel')}>
            Accel E
          </button>
        </div>
      </div>
      <div>
        <div style={LABEL_STYLE}>Camera</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
          <button style={btn(false, '#ff9050')} onClick={onResetView}>Reset view</button>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button style={ICON_BTN_STYLE} onClick={onZoomOut}>−</button>
            <span style={{ color: '#71717a', fontSize: '11px' }}>zoom</span>
            <button style={ICON_BTN_STYLE} onClick={onZoomIn}>+</button>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 28px)',
            gridTemplateRows: 'repeat(3, 28px)',
            gap: '3px',
          }}>
            <span /><button style={ICON_BTN_STYLE} onClick={onPanUp}>↑</button><span />
            <button style={ICON_BTN_STYLE} onClick={onPanLeft}>←</button>
            <span />
            <button style={ICON_BTN_STYLE} onClick={onPanRight}>→</button>
            <span /><button style={ICON_BTN_STYLE} onClick={onPanDown}>↓</button><span />
          </div>
        </div>
      </div>
    </div>
  );
}

// ControlPanel — floating glass panel for mode and field-layer controls.
//
// Pure presentation component. No simulation state, no physics knowledge.

import type { CSSProperties } from 'react';

type DemoMode = 'stationary' | 'uniform_velocity';
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
  border: '1px solid rgba(255,140,60,0.3)',
  borderRadius: '8px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  color: '#d0c0b0',
  fontSize: '12px',
  userSelect: 'none',
  pointerEvents: 'auto',
};

const LABEL_STYLE: CSSProperties = {
  fontWeight: 600,
  marginBottom: '5px',
  color: 'rgba(255,160,80,0.7)',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
};

const BTN_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: '5px',
  flexWrap: 'wrap',
};

const ICON_BTN_STYLE: CSSProperties = {
  width: '26px',
  height: '26px',
  borderRadius: '4px',
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(200,180,160,0.8)',
  cursor: 'pointer',
  fontSize: '13px',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function btn(active: boolean, color: string): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: '4px',
    border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
    background: active ? color + '28' : 'transparent',
    color: active ? color : 'rgba(200,180,160,0.6)',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'border-color 0.1s, color 0.1s, background 0.1s',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-start' }}>
          <button style={btn(false, '#ff9050')} onClick={onResetView}>Reset view</button>
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            <button style={ICON_BTN_STYLE} onClick={onZoomOut}>−</button>
            <span style={{ color: 'rgba(200,180,160,0.4)', fontSize: '11px' }}>zoom</span>
            <button style={ICON_BTN_STYLE} onClick={onZoomIn}>+</button>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 26px)',
            gridTemplateRows: 'repeat(3, 26px)',
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

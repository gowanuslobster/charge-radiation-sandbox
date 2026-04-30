// FieldProbePanel — draggable, collapsible floating panel showing the
// instantaneous LW field at the probe point and a rolling sparkline for the
// selected channel.
//
// Pure presentation. The probe state, ring buffer, and channel selection live
// in `useFieldProbe`. This component takes the snapshot and renders it.
//
// Position is owned by the parent so it persists across mode changes (the
// probe itself is cleared on mode change, so the panel un-renders, but the
// next probe placement reuses the saved position).

import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo } from 'react';
import type { Vec2 } from '@/physics/types';
import {
  type ProbeChannel,
  PROBE_CHANNELS,
} from '@/physics/probeChannel';
import type { ProbeInstant } from './useFieldProbe';

type Props = {
  position: Vec2;
  channel: ProbeChannel;
  instant: ProbeInstant | null;
  displaySamples: Float32Array;
  onChannelChange: (channel: ProbeChannel) => void;
  onClear: () => void;
  pos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
};

const CHANNEL_LABEL: Record<ProbeChannel, string> = {
  Ex:   'Eₓ',
  Ey:   'Eᵧ',
  Emag: '|E|',
  Bz:   'Bz',
  Sx:   'Sₓ',
  Sy:   'Sᵧ',
  Smag: '|S|',
};

const SPARK_W = 260;
const SPARK_H = 80;
const SPARK_PAD_X = 6;
const SPARK_PAD_Y = 6;

// Magnitudes are the only non-negative channels; everything else preserves sign.
function isSignedChannel(ch: ProbeChannel): boolean {
  return ch !== 'Emag' && ch !== 'Smag';
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0.000';
  if (abs < 1e-3 || abs >= 1e4) return v.toExponential(2);
  return v.toFixed(3);
}

// Peak-symmetric Y axis. Always returns a positive number.
function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (Number.isFinite(v)) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  return Math.max(peak, 1e-12);
}

// Build a single SVG path string. NaN samples break the line.
// Signed: zero is the midline, ±peak at top/bottom.
// Unsigned: zero is the bottom, peak at top (no negative half).
function buildSparkPath(samples: Float32Array, peak: number, signed: boolean): string {
  if (samples.length < 1) return '';
  const innerW = SPARK_W - 2 * SPARK_PAD_X;
  const innerH = SPARK_H - 2 * SPARK_PAD_Y;
  const baselineY = signed ? SPARK_PAD_Y + innerH / 2 : SPARK_H - SPARK_PAD_Y;
  const span      = signed ? innerH / 2 : innerH;
  const xStep     = samples.length > 1 ? innerW / (samples.length - 1) : 0;
  let d = '';
  let penDown = false;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) {
      penDown = false;
      continue;
    }
    const x = SPARK_PAD_X + i * xStep;
    const y = baselineY - (v / peak) * span;
    d += penDown ? `L${x.toFixed(2)} ${y.toFixed(2)} ` : `M${x.toFixed(2)} ${y.toFixed(2)} `;
    penDown = true;
  }
  return d;
}

export function FieldProbePanel({
  position,
  channel,
  instant,
  displaySamples,
  onChannelChange,
  onClear,
  pos,
  onPosChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = useCallback((x: number, y: number) => {
    const pw = panelRef.current?.offsetWidth ?? 200;
    const ph = panelRef.current?.offsetHeight ?? 60;
    return {
      x: Math.max(0, Math.min(window.innerWidth - pw, x)),
      y: Math.max(0, Math.min(window.innerHeight - ph, y)),
    };
  }, []);

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragOffsetRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pos]);

  const handleHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragOffsetRef.current === null) return;
    e.stopPropagation();
    onPosChange(clamp(e.clientX - dragOffsetRef.current.dx, e.clientY - dragOffsetRef.current.dy));
  }, [clamp, onPosChange]);

  const handleHeaderPointerUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    dragOffsetRef.current = null;
  }, []);

  // Clamp on mount once the panel has been measured.
  useLayoutEffect(() => {
    onPosChange(clamp(pos.x, pos.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-clamp when the panel collapses/expands (its height changes).
  useLayoutEffect(() => {
    onPosChange(clamp(pos.x, pos.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    const onResize = () => onPosChange(clamp(pos.x, pos.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, clamp, onPosChange]);

  const signed = isSignedChannel(channel);
  const peak = useMemo(() => computePeak(displaySamples), [displaySamples]);
  const path = useMemo(
    () => buildSparkPath(displaySamples, peak, signed),
    [displaySamples, peak, signed],
  );

  const activeValue = instant ? instant[channel] : NaN;

  return (
    <div
      ref={panelRef}
      className="absolute z-20 flex flex-col rounded-2xl border border-orange-400/20 bg-black/65 text-sm text-zinc-200 backdrop-blur-md select-none pointer-events-auto overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: expanded ? SPARK_W + 32 : 'auto', minWidth: 200 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle header */}
      <div
        className="flex items-center gap-2 cursor-grab px-3 py-2 border-b border-orange-400/10 active:cursor-grabbing"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
      >
        <span className="flex-1 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400">
          Field probe
        </span>
        {!expanded && (
          <span className="font-mono text-[11px] text-orange-200">
            {CHANNEL_LABEL[channel]} {fmt(activeValue)}
          </span>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setExpanded(v => !v)}
          className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-100 transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClear}
          className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
          aria-label="Clear probe"
          title="Clear probe"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2.5 p-3">
          {/* World position */}
          <div className="font-mono text-[11px] text-zinc-400">
            x = {fmt(position.x)}   y = {fmt(position.y)}
          </div>

          {/* Channel chips */}
          <div className="flex flex-wrap gap-1">
            {PROBE_CHANNELS.map(ch => {
              const active = ch === channel;
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => onChannelChange(ch)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-amber-400/80 text-black shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                      : 'bg-amber-400/15 text-amber-200 hover:bg-amber-400/30'
                  }`}
                >
                  {CHANNEL_LABEL[ch]}
                </button>
              );
            })}
          </div>

          {/* Active channel instant value */}
          <div className="font-mono text-xs text-orange-200">
            {CHANNEL_LABEL[channel]} = {fmt(activeValue)}
          </div>

          {/* Sparkline */}
          <div className="rounded border border-white/5 bg-black/40">
            <svg
              width={SPARK_W}
              height={SPARK_H}
              viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
              className="block"
            >
              {/* Zero baseline — midline for signed channels, bottom for unsigned */}
              <line
                x1={SPARK_PAD_X}
                x2={SPARK_W - SPARK_PAD_X}
                y1={signed ? SPARK_H / 2 : SPARK_H - SPARK_PAD_Y}
                y2={signed ? SPARK_H / 2 : SPARK_H - SPARK_PAD_Y}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              {/* Trace */}
              {path !== '' && (
                <path
                  d={path}
                  fill="none"
                  stroke="rgb(251,191,36)"
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {/* Y-axis tick labels */}
              <text x={2} y={SPARK_PAD_Y + 8} fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="monospace">
                {fmt(peak)}
              </text>
              {signed ? (
                <>
                  <text x={2} y={SPARK_H / 2 + 3} fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="monospace">
                    0
                  </text>
                  <text x={2} y={SPARK_H - SPARK_PAD_Y} fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="monospace">
                    {fmt(-peak)}
                  </text>
                </>
              ) : (
                <text x={2} y={SPARK_H - SPARK_PAD_Y} fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="monospace">
                  0
                </text>
              )}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

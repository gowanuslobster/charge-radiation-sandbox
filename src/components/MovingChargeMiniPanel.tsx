// MovingChargeMiniPanel — draggable floating panel for moving_charge mode controls.
//
// Shown only when demoMode === 'moving_charge'. Position is owned by the parent
// (ChargeRadiationSandbox) so it persists across mode switches within a session.
// Clamped to viewport during drag and on window resize.

import { useRef, useEffect, useLayoutEffect, useCallback } from 'react';

type Props = {
  stopTriggered: boolean;
  showGhost: boolean;
  /** Whether the ghost velocity-field streamline overlay is active. */
  showGhostStreamlines: boolean;
  onStopNow: () => void;
  onToggleGhost: () => void;
  /** Toggle ghost velocity-field streamlines. Only meaningful when showGhost is true. */
  onToggleGhostStreamlines: () => void;
  pos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
};

const TOGGLE_BASE = 'rounded-md px-3 py-2 text-sm font-medium transition-all duration-200';

export function MovingChargeMiniPanel({
  stopTriggered, showGhost, showGhostStreamlines,
  onStopNow, onToggleGhost, onToggleGhostStreamlines,
  pos, onPosChange,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = useCallback((x: number, y: number) => {
    const pw = panelRef.current?.offsetWidth ?? 180;
    const ph = panelRef.current?.offsetHeight ?? 120;
    return {
      x: Math.max(0, Math.min(window.innerWidth - pw, x)),
      y: Math.max(0, Math.min(window.innerHeight - ph, y)),
    };
  }, []);

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragOffsetRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pos]);

  const handleHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragOffsetRef.current === null) return;
    onPosChange(clamp(e.clientX - dragOffsetRef.current.dx, e.clientY - dragOffsetRef.current.dy));
  }, [clamp, onPosChange]);

  const handleHeaderPointerUp = useCallback(() => {
    dragOffsetRef.current = null;
  }, []);

  // Clamp on mount (after the panel is sized) so it can't start off-screen.
  useLayoutEffect(() => {
    onPosChange(clamp(pos.x, pos.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once at mount only

  // Clamp position on window resize to keep the panel on screen.
  useEffect(() => {
    const onResize = () => onPosChange(clamp(pos.x, pos.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, clamp, onPosChange]);

  return (
    <div
      ref={panelRef}
      className="absolute z-20 flex flex-col rounded-2xl border border-orange-400/20 bg-black/65 text-sm text-zinc-200 backdrop-blur-md select-none pointer-events-auto overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Drag handle header */}
      <div
        className="cursor-grab px-4 py-2 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400 border-b border-orange-400/10 active:cursor-grabbing"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
      >
        Moving charge
      </div>
      <div className="flex flex-col gap-2 p-4">
        <button
          type="button"
          onClick={onStopNow}
          disabled={stopTriggered}
          className={stopTriggered
            ? 'rounded-md px-3 py-2 text-sm font-medium bg-red-500/10 text-red-300/40 cursor-not-allowed'
            : 'rounded-md px-3 py-2 text-sm font-medium bg-red-500/20 text-red-300 hover:bg-red-500/35 transition-colors duration-200'}
        >
          Stop now
        </button>
        <button
          type="button"
          onClick={onToggleGhost}
          className={`${TOGGLE_BASE} ${showGhost
            ? 'bg-zinc-300 text-black shadow-[0_0_12px_rgba(255,255,255,0.25)]'
            : 'bg-zinc-200/20 text-zinc-200 hover:bg-zinc-200/32'}`}
        >
          Ghost charge
        </button>
        {showGhost && (
          <button
            type="button"
            onClick={onToggleGhostStreamlines}
            className={`${TOGGLE_BASE} ${showGhostStreamlines
              ? 'bg-amber-400/80 text-black shadow-[0_0_12px_rgba(251,191,36,0.35)]'
              : 'bg-amber-400/15 text-amber-200 hover:bg-amber-400/28'}`}
          >
            Ghost field lines
          </button>
        )}
      </div>
    </div>
  );
}

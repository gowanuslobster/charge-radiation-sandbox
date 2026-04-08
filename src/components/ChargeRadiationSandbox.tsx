// ChargeRadiationSandbox — main orchestrator component.
//
// Owns the simulation RAF loop, charge history, and demo/display state.
// VectorFieldCanvas runs its own RAF loop and reads simulation state from refs;
// no parent-to-canvas signaling is needed.
//
// SEEDING INVARIANTS:
//   - hasSeededRef guards the simulation tick and mode-change effect against
//     running before initialization (avoids stale-history physics on early frames).
//   - reseedBoundsRef stores a snapshot of defaultBounds at reseed time so the
//     auto-reseed check is camera-independent: panning away from the charge
//     never triggers a reseed. The only trigger is the charge drifting outside
//     the bounds it was seeded in.
//   - reseed() always calls resetCamera() so reseedBoundsRef is always source-
//     centered, making the check loop-safe: reseed cannot immediately re-fire.
//
// HISTORY HORIZON:
//   maxCornerDist(sourcePos, viewBounds) / (c − speed) is the velocity-aware
//   maximum observer-to-source travel time. For a forward observer at distance R
//   behind a source moving at v: t_ret ≈ R/(c−v), not R/c.
//   Precondition: speed < c — same contract as M1's MAX_BETA_SQ guard.
//
// NOTE FOR M3+:
//   M2 modes are analytic (sampleSourceState reconstructs exact past states),
//   so reseeding is lossless. Non-analytic M3+ modes cannot reseed after zoom-out
//   because recorded history would be lost; M3 should accept clamp fallback instead.

import { useState, useRef, useCallback, useEffect } from 'react';
import { ChargeHistory } from '@/physics/chargeHistory';
import { magnitude } from '@/physics/vec2';
import type { SimConfig } from '@/physics/types';
import {
  type DemoMode,
  sampleSourceState,
  maxHistorySpeed,
  brakingSubstepTimes,
  SUDDEN_STOP_X_STOP,
} from '@/physics/demoModes';
import { type DragState, computeDragState, stoppedDragState } from '@/physics/dragKinematics';
import { useSandboxCamera } from './useSandboxCamera';
import { VectorFieldCanvas } from './VectorFieldCanvas';
import { ControlPanel } from './ControlPanel';
import { isWithinBounds, maxCornerDist, worldToScreen, type WorldBounds } from '@/rendering/worldSpace';
import { hitTestCharge } from '@/rendering/chargeHitTest';

type FieldLayer = 'total' | 'vel' | 'accel';

export function ChargeRadiationSandbox() {
  const [fieldLayer, setFieldLayer] = useState<FieldLayer>('total');
  const [demoMode, setDemoMode] = useState<DemoMode>('stationary');

  const containerRef = useRef<HTMLDivElement>(null);
  const {
    viewBounds,
    defaultBounds,
    zoom,
    isPanning,
    getWorldFromClientPoint,
    beginPan,
    handleGlobalPointerMove,
    handleGlobalPointerUp,
    zoomAtClientPoint,
    zoomAtCenter,
    resetCamera,
    panBy,
  } = useSandboxCamera({ containerRef });

  const PAN_STEP_PX = 80;

  // Simulation refs — written by the RAF tick, read by VectorFieldCanvas.
  const historyRef = useRef(new ChargeHistory());
  const simTimeRef = useRef(0);
  // Incremented on every reseed so VectorFieldCanvas re-solves even when paused.
  const simEpochRef = useRef(0);
  const chargeRef = useRef(1);
  const configRef = useRef<SimConfig>({ c: 1.0, softening: 0.01 });
  const rafRef = useRef(0);
  const lastWallTimeRef = useRef(0);

  // Seeding-invariant refs (see module comment).
  const reseedBoundsRef = useRef<WorldBounds | null>(null);
  const defaultBoundsRef = useRef<WorldBounds | null>(null);
  const hasSeededRef = useRef(false);

  // Keep defaultBoundsRef current so effects and the tick can read it via ref
  // without those closures being in dependency arrays (prevents resize-triggered reseeds).
  useEffect(() => {
    defaultBoundsRef.current = defaultBounds;
  }, [defaultBounds]);

  // Keep viewBounds and demoMode available to the RAF tick via refs.
  const viewBoundsRef = useRef(viewBounds);
  useEffect(() => { viewBoundsRef.current = viewBounds; }, [viewBounds]);

  const demoModeRef = useRef(demoMode);
  useEffect(() => { demoModeRef.current = demoMode; }, [demoMode]);

  // Pause / step-forward state.
  // isPausedRef is read inside the RAF closure; isPaused drives the button label.
  // pendingStepRef signals the next tick to advance by STEP_DT and then stop again.
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const pendingStepRef = useRef(false);

  // ─── Drag state (draggable mode) ─────────────────────────────────────────────

  // Drag input: pointer handlers write these; tick reads them.
  // isDraggingRef: true while the user holds the left button on the charge.
  // rawDragPosRef: latest world-space pointer position; null until first pointermove.
  const isDraggingRef = useRef(false);
  const rawDragPosRef = useRef<{ x: number; y: number } | null>(null);

  // Drag kinematics: owned entirely by the simulation tick.
  // Updated every tick via computeDragState / stoppedDragState.
  const dragStateRef = useRef<DragState | null>(null);

  // Retained peak speed for the velocity-aware history horizon.
  // Only resets on reseed / mode-change — NOT on each new pointer-down — so that
  // far observers keep the wider history window from earlier fast motion.
  const dragPeakSpeedRef = useRef(0);

  const togglePause = useCallback(() => {
    isPausedRef.current = !isPausedRef.current;
    if (isPausedRef.current && isDraggingRef.current) {
      // End any active drag immediately when the simulation is paused.
      isDraggingRef.current = false;
    }
    setIsPaused(isPausedRef.current);
  }, []);

  const stepForward = useCallback(() => {
    pendingStepRef.current = true;
  }, []);

  // ─── Seeding ────────────────────────────────────────────────────────────────

  const reseed = useCallback((mode: DemoMode, db: WorldBounds) => {
    // Reset camera so reseedBoundsRef is always source-centered.
    // defaultBounds == the bounds at zoom=1, offset=0, which is passed as `db`.
    resetCamera();

    historyRef.current = new ChargeHistory();
    simTimeRef.current = 0;
    lastWallTimeRef.current = performance.now();
    simEpochRef.current += 1;

    // Snapshot the source-centered bounds for the auto-reseed check.
    reseedBoundsRef.current = db;

    // ── Draggable mode: single stationary history entry at center; no analytic seeding.
    if (mode === 'draggable') {
      const center = { x: (db.minX + db.maxX) / 2, y: (db.minY + db.maxY) / 2 };
      dragStateRef.current = { pos: center, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
      rawDragPosRef.current = null;
      isDraggingRef.current = false;
      dragPeakSpeedRef.current = 0; // reset on reseed / mode-change only
      historyRef.current.recordState({
        pos: center, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, t: 0,
      });
      hasSeededRef.current = true;
      return;
    }

    // Seed history with analytically computed past states.
    // seedSpeed drives the velocity-aware horizon (see module comment).
    const seedState = sampleSourceState(mode, 0);
    const seedSpeed = magnitude(seedState.vel); // 0 for stationary, 0.6 for uniform_velocity
    const config = configRef.current;
    // Precondition: seedSpeed < config.c (same contract as M1 MAX_BETA_SQ guard).
    const historyWindow = maxCornerDist(seedState.pos, db) / (config.c - seedSpeed);
    const n = Math.ceil(historyWindow / 0.05);
    const history = historyRef.current;
    for (let i = -n; i <= 0; i++) {
      history.recordState(sampleSourceState(mode, i * 0.05));
    }

    hasSeededRef.current = true;
  }, [resetCamera]);

  // Effect A — initial seed: fires once when the container is first measured.
  // demoMode is intentionally excluded: initial mode is read from demoModeRef to
  // handle the (unlikely) case where demoMode changes before the first measurement.
  // A window resize changes defaultBounds → triggers this effect → exits via hasSeededRef
  // guard → no spurious reseed. Effect B handles all subsequent mode changes.
  useEffect(() => {
    if (defaultBounds === null) return;
    if (hasSeededRef.current) return; // already seeded — ignore subsequent resize events
    reseed(demoModeRef.current, defaultBounds);
  }, [defaultBounds, reseed]); // demoMode intentionally excluded

  // Effect B — mode-change reseed: fires when demoMode changes after initialization.
  // defaultBounds is intentionally read via ref (not listed as a dep) so that a window
  // resize changing defaultBounds never triggers a spurious reseed through this path.
  useEffect(() => {
    if (!hasSeededRef.current) return; // not yet initialized — Effect A handles first seed
    const db = defaultBoundsRef.current;
    if (db === null) return;
    reseed(demoMode, db);
  }, [demoMode, reseed]); // defaultBounds intentionally excluded via ref

  // ─── Simulation tick ────────────────────────────────────────────────────────

  useEffect(() => {
    function tick(wallTime: number) {
      rafRef.current = requestAnimationFrame(tick);

      // Step 0: initialization guard — no-op until first reseed completes.
      if (!hasSeededRef.current) return;

      // Steps 1-2: advance simulation time.
      // lastWallTimeRef is always updated, even when paused, so resume is seamless.
      // dt is capped to 50 ms to prevent spiral-of-death when the tab is hidden.
      const rawDt = Math.min(wallTime - lastWallTimeRef.current, 50) / 1000;
      lastWallTimeRef.current = wallTime;

      // Pause / step-forward: when paused and no step is pending, freeze here.
      // When a step is pending, advance by one fixed step (≈1/30 s) and stop again.
      const STEP_DT = 1 / 30;
      if (isPausedRef.current && !pendingStepRef.current) return;
      const dt = isPausedRef.current ? STEP_DT : rawDt;
      if (isPausedRef.current) pendingStepRef.current = false;

      simTimeRef.current += dt;

      // Step 3: sample source state.
      const mode = demoModeRef.current;

      // ── Draggable branch: tick owns kinematics; returns early.
      // pointer handlers write isDraggingRef + rawDragPosRef; tick reads them.
      if (mode === 'draggable') {
        const history = historyRef.current;
        const config = configRef.current;

        if (isDraggingRef.current && rawDragPosRef.current !== null) {
          // Compute vel/accel from tick-dt; zero-motion guard lives inside computeDragState.
          dragStateRef.current = computeDragState(
            rawDragPosRef.current,
            dragStateRef.current,
            dt,
            config.c,
          );
          const speed = magnitude(dragStateRef.current.vel);
          if (speed > dragPeakSpeedRef.current) dragPeakSpeedRef.current = speed;
        } else if (!isDraggingRef.current && dragStateRef.current) {
          // Released or pause-ended: freeze immediately.
          // The velocity discontinuity is a real stopping event in history — correct.
          dragStateRef.current = stoppedDragState(dragStateRef.current.pos);
          // dragPeakSpeedRef is NOT reset here — far observers may still need
          // the wider history window from earlier fast motion.
        }

        if (!dragStateRef.current) return; // not yet seeded

        const ds = dragStateRef.current;
        history.recordState({ pos: ds.pos, vel: ds.vel, accel: ds.accel, t: simTimeRef.current });

        // Use retained peak (not current) speed for the history horizon.
        // Same rationale as maxHistorySpeed in M3: far observers need pre-stop
        // history at travel time R/(c−V_peak), not R/c.
        const horizonSpeed = Math.min(dragPeakSpeedRef.current, config.c * 0.92);
        history.setMaxHistoryTime(
          maxCornerDist(ds.pos, viewBoundsRef.current) / (config.c - horizonSpeed)
        );
        history.pruneToWindow(simTimeRef.current);
        return;
      }

      const sourceState = sampleSourceState(mode, simTimeRef.current);

      // Step 4: UX auto-reseed check (uniform_velocity only).
      // Compares against reseedBoundsRef (source-centered snapshot) not viewBounds,
      // so camera panning never triggers a reseed.
      // Margin 1.0 world unit: at vel=0.6 and 60 FPS, max per-tick drift ≈ 0.01 units —
      // one tick cannot overshoot this margin.
      if (mode === 'uniform_velocity' && reseedBoundsRef.current !== null) {
        if (!isWithinBounds(sourceState.pos, reseedBoundsRef.current, 1.0)) {
          // safe: hasSeededRef.current === true implies defaultBoundsRef.current !== null
          reseed(mode, defaultBoundsRef.current!);
          return;
        }
      }

      // Steps 5-7: record state, set velocity-aware history horizon, prune.
      const history = historyRef.current;
      const config = configRef.current;

      // For sudden_stop, record exact phase-boundary times and interior substeps
      // before the main state. This prevents ChargeHistory's linear interpolation
      // from smearing the acceleration step across an entire frame interval.
      if (mode === 'sudden_stop') {
        const prevSimTime = simTimeRef.current - dt;
        for (const tSub of brakingSubstepTimes(prevSimTime, simTimeRef.current)) {
          history.recordState(sampleSourceState('sudden_stop', tSub));
        }
      }
      history.recordState(sourceState);

      // Use peak mode speed (not current speed) for the history horizon.
      // For sudden_stop this keeps outside-shell history after the charge stops:
      // those observers need the pre-stop moving history at effective travel time
      // R/(c−V), not R/c. See demoModes.ts: maxHistorySpeed for the M5 caveat.
      const horizonSpeed = maxHistorySpeed(mode);
      // Precondition: horizonSpeed < config.c (same contract as M1 MAX_BETA_SQ guard).
      history.setMaxHistoryTime(
        maxCornerDist(sourceState.pos, viewBoundsRef.current) / (config.c - horizonSpeed)
      );
      history.pruneToWindow(simTimeRef.current);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reseed]);

  // ─── Event wiring ───────────────────────────────────────────────────────────

  // Global pointer events: pan continues when pointer leaves the container.
  // Also handles drag updates for draggable mode.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      handleGlobalPointerMove(e); // pan
      if (isDraggingRef.current && demoModeRef.current === 'draggable') {
        if (isPausedRef.current) return; // ignore pointer moves while paused
        const worldPos = getWorldFromClientPoint(e.clientX, e.clientY);
        if (worldPos !== null) rawDragPosRef.current = worldPos;
      }
    };
    const onUp = (e: PointerEvent) => {
      handleGlobalPointerUp();
      if (e.button === 0 && isDraggingRef.current) {
        isDraggingRef.current = false;
        // Clear stale position so the next drag start doesn't consume it
        // before the first pointermove of the new drag arrives.
        rawDragPosRef.current = null;
        // Tick sees isDraggingRef === false next frame and records stopped state.
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [handleGlobalPointerMove, handleGlobalPointerUp, getWorldFromClientPoint]);

  // Wheel zoom: added as a non-passive listener so preventDefault() is honored.
  // zoomRef tracks current zoom in a ref so the listener closure never goes stale.
  const zoomForWheelRef = useRef(zoom);
  useEffect(() => { zoomForWheelRef.current = zoom; }, [zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const desiredZoom = zoomForWheelRef.current * Math.exp(-e.deltaY * 0.0015);
      zoomAtClientPoint(e.clientX, e.clientY, desiredZoom);
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomAtClientPoint]); // zoomAtClientPoint is stable; zoom read via ref

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Right-click (button=2) or middle-click (button=1) initiates pan.
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      beginPan(e.clientX, e.clientY);
      return;
    }
    // Left-click (button=0) in draggable mode: hit-test the charge and start drag.
    if (e.button === 0 && demoModeRef.current === 'draggable') {
      if (isPausedRef.current) return; // drag blocked while paused

      const rect = containerRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Convert charge world position to canvas pixels for the hit test.
      const chargePos = dragStateRef.current?.pos ?? { x: 0, y: 0 };
      const cp = worldToScreen(chargePos, viewBoundsRef.current, rect.width, rect.height);

      if (hitTestCharge(cx, cy, cp.x, cp.y)) {
        e.preventDefault(); // prevent browser drag/selection on successful grab
        isDraggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  }, [beginPan]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#0d0d12]"
      style={demoMode === 'draggable' ? { cursor: 'crosshair' } : undefined}
      onPointerDown={handlePointerDown}
      onContextMenu={e => e.preventDefault()}
    >
      <VectorFieldCanvas
        historyRef={historyRef}
        simulationTimeRef={simTimeRef}
        chargeRef={chargeRef}
        configRef={configRef}
        simEpochRef={simEpochRef}
        bounds={viewBounds}
        fieldLayer={fieldLayer}
        isPanning={isPanning}
        isPausedRef={isPausedRef}
        wallWorldX={demoMode === 'sudden_stop' ? SUDDEN_STOP_X_STOP : null}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <ControlPanel
        demoMode={demoMode}
        fieldLayer={fieldLayer}
        isPaused={isPaused}
        onDemoModeChange={setDemoMode}
        onFieldLayerChange={setFieldLayer}
        onPauseToggle={togglePause}
        onStepForward={stepForward}
        onResetView={resetCamera}
        onZoomIn={() => zoomAtCenter(zoom * 1.5)}
        onZoomOut={() => zoomAtCenter(zoom / 1.5)}
        onPanLeft={() => panBy(-PAN_STEP_PX, 0)}
        onPanRight={() => panBy(PAN_STEP_PX, 0)}
        onPanUp={() => panBy(0, -PAN_STEP_PX)}
        onPanDown={() => panBy(0, PAN_STEP_PX)}
      />
    </div>
  );
}

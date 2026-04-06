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
} from '@/physics/demoModes';
import { useSandboxCamera } from './useSandboxCamera';
import { VectorFieldCanvas } from './VectorFieldCanvas';
import { ControlPanel } from './ControlPanel';
import { isWithinBounds, maxCornerDist, type WorldBounds } from '@/rendering/worldSpace';

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

  const togglePause = useCallback(() => {
    isPausedRef.current = !isPausedRef.current;
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

    // Snapshot the source-centered bounds for the auto-reseed check.
    reseedBoundsRef.current = db;

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
  useEffect(() => {
    const onMove = (e: PointerEvent) => { handleGlobalPointerMove(e); };
    const onUp = () => { handleGlobalPointerUp(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [handleGlobalPointerMove, handleGlobalPointerUp]);

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
    // Primary button (button=0) is reserved for charge dragging in M4.
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      beginPan(e.clientX, e.clientY);
    }
  }, [beginPan]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#0d0d12]"
      onPointerDown={handlePointerDown}
      onContextMenu={e => e.preventDefault()}
    >
      <VectorFieldCanvas
        historyRef={historyRef}
        simulationTimeRef={simTimeRef}
        chargeRef={chargeRef}
        configRef={configRef}
        bounds={viewBounds}
        fieldLayer={fieldLayer}
        isPanning={isPanning}
        isPausedRef={isPausedRef}
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

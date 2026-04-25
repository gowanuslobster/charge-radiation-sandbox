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
import type { ChargeRuntime } from '@/physics/chargeRuntime';
import { magnitude } from '@/physics/vec2';
import type { SimConfig, Vec2 } from '@/physics/types';
import {
  type DemoMode,
  type MagneticHeatmapMode,
  sampleSourceState,
  sampleDemoChargeStates,
  sampleSuddenStopState,
  maxHistorySpeed,
  brakingSubstepTimes,
  SUDDEN_STOP_V,
} from '@/physics/demoModes';
import { type DragState, computeDragState, stoppedDragState } from '@/physics/dragKinematics';
import { useSandboxCamera } from './useSandboxCamera';
import { VectorFieldCanvas } from './VectorFieldCanvas';
import { WavefrontOverlayCanvas } from './WavefrontOverlayCanvas';
import { WavefrontWebGLCanvas } from './WavefrontWebGLCanvas';
import { minCForMode } from '@/rendering/wavefrontWebGLConfig';
import { ControlPanel } from './ControlPanel';
import { MovingChargeMiniPanel } from './MovingChargeMiniPanel';
import { StreamlineCanvas } from './StreamlineCanvas';
import { useCursorReadout } from './useCursorReadout';
import { StartPanel } from './StartPanel';
import { isWithinBounds, maxCornerDist, worldToScreen, type WorldBounds } from '@/rendering/worldSpace';
import { hitTestCharge } from '@/rendering/chargeHitTest';

type FieldLayer = 'total' | 'vel' | 'accel';

export function ChargeRadiationSandbox() {
  const [fieldLayer, setFieldLayer] = useState<FieldLayer>('total');
  const [demoMode, setDemoMode] = useState<DemoMode>('draggable');
  const [isPaused, setIsPaused] = useState(false);
  const [dragCalloutPos, setDragCalloutPos] = useState<{ x: number; y: number } | null>(null);
  const dragCalloutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mini panel position for moving_charge mode. Persists across mode switches within session.
  // Default: horizontally centered under the charge (which starts at screen center),
  // offset down by the charge marker radius (8px) plus 24px padding.
  const [miniPanelPos, setMiniPanelPos] = useState(() => ({
    x: window.innerWidth / 2 - 90,
    y: window.innerHeight / 2 + 32,
  }));

  // moving_charge UI state.
  const [stopTriggered, setStopTriggered] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const [c, setC] = useState(1.0);

  // Overlay state. `magneticHeatmapMode` replaces the pre-M11 boolean
  // `showRadiationHeatmap`: the overlay is now a 4-state channel picker
  // (off / total B / velocity B / accel B). The wavefront contour remains a
  // radiation annotation driven by bZAccel, independent of this channel.
  const [magneticHeatmapMode, setMagneticHeatmapMode] = useState<MagneticHeatmapMode>('off');
  const [showWavefrontContours, setShowWavefrontContours] = useState(false);
  const [showVelocityVectors, setShowVelocityVectors] = useState(true);

  // WebGL capability detection. null = detecting, true = WebGL2+RGBA32F ready, false = fallback.
  const [webGLReady, setWebGLReady] = useState<boolean | null>(null);
  useEffect(() => {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!gl) { setWebGLReady(false); return; }
    // Verify RGBA32F texture support (not guaranteed on all WebGL2 contexts)
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
    const floatOk = gl.getError() === gl.NO_ERROR;
    gl.deleteTexture(tex);
    // Verify MAX_TEXTURE_SIZE supports the 2D history texture layout (TEX_WIDTH=512, TEX_HEIGHT=32)
    const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const sizeOk = maxTexSize >= 512;  // 512 is the binding constraint; TEX_HEIGHT=32 ≪ 2048
    setWebGLReady(floatOk && sizeOk);
  }, []);

  // Both toggles default to off. showGhostStreamlines is only meaningful
  // when showGhost is also on (ghost pos is non-null) in moving_charge mode.
  const [showStreamlines, setShowStreamlines] = useState(false);
  const [showGhostStreamlines, setShowGhostStreamlines] = useState(false);

  // Start panel — shown on initial load and after Reset.
  // While visible, no mode is highlighted in the ControlPanel.
  const [showStartPanel, setShowStartPanel] = useState(true);
  const showStartPanelRef = useRef(true);
  useEffect(() => { showStartPanelRef.current = showStartPanel; }, [showStartPanel]);

  // Prevents effect B from double-reseeding when handleDemoModeChange is
  // called from the start panel and the mode actually changes: in that path
  // we call reseed() directly before setDemoMode(), so effect B must skip.
  const skipModeChangeReseedRef = useRef(false);

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

  // Simulation refs — written by the RAF tick, read by child canvases.
  // chargeRuntimesRef holds one entry per charge: single-charge modes use length-1;
  // dipole and hydrogen use length-2 (charges +1 and -1).
  const chargeRuntimesRef = useRef<ChargeRuntime[]>([{ history: new ChargeHistory(), charge: 1 }]);
  const simTimeRef = useRef(0);
  // Incremented on every reseed so paused canvases re-solve the current frame.
  const simEpochRef = useRef(0);
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
  const isPausedRef = useRef(false);
  const pendingStepRef = useRef(false);

  // ─── M5 refs ─────────────────────────────────────────────────────────────────

  // stopTriggerTimeRef: null = pre-trigger (charge at constant velocity);
  // non-null = sim time when the student clicked Stop now (= brakeStartTime).
  const stopTriggerTimeRef = useRef<number | null>(null);

  // showGhostRef: mirrors showGhost state for synchronous read by the tick.
  const showGhostRef = useRef(false);
  useEffect(() => { showGhostRef.current = showGhost; }, [showGhost]);

  // ghostPosRef: world-space position of the ghost charge overlay.
  // Written by tick (during playback) and by handlers (for paused responsiveness).
  // Read by VectorFieldCanvas for rendering only — not a physics source.
  const ghostPosRef = useRef<Vec2 | null>(null);

  // Canvas ref: shared between VectorFieldCanvas (for drawing) and useCursorReadout
  // (for canvas-scoped pointer listeners).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ─── Drag state (draggable mode) ─────────────────────────────────────────────

  const isDraggingRef = useRef(false);
  const rawDragPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragPeakSpeedRef = useRef(0);

  const togglePause = useCallback(() => {
    isPausedRef.current = !isPausedRef.current;
    if (isPausedRef.current && isDraggingRef.current) {
      isDraggingRef.current = false;
    }
    if (!isPausedRef.current && dragCalloutTimerRef.current !== null) {
      clearTimeout(dragCalloutTimerRef.current);
      dragCalloutTimerRef.current = null;
      setDragCalloutPos(null);
    }
    setIsPaused(isPausedRef.current);
  }, []);

  const stepForward = useCallback(() => {
    pendingStepRef.current = true;
  }, []);

  // ─── Seeding ────────────────────────────────────────────────────────────────

  const reseed = useCallback((mode: DemoMode, db: WorldBounds) => {
    // Clear moving_charge trigger state unconditionally on every reseed.
    stopTriggerTimeRef.current = null;
    ghostPosRef.current = null;

    // Reset camera so reseedBoundsRef is always source-centered.
    resetCamera();

    simTimeRef.current = 0;
    lastWallTimeRef.current = performance.now();
    simEpochRef.current += 1;
    reseedBoundsRef.current = db;

    // ── Draggable mode: single stationary history entry at center.
    if (mode === 'draggable') {
      const center = { x: (db.minX + db.maxX) / 2, y: (db.minY + db.maxY) / 2 };
      dragStateRef.current = { pos: center, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 } };
      rawDragPosRef.current = null;
      isDraggingRef.current = false;
      dragPeakSpeedRef.current = 0;
      const h = new ChargeHistory();
      h.recordState({ pos: center, vel: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, t: 0 });
      chargeRuntimesRef.current = [{ history: h, charge: 1 }];
      hasSeededRef.current = true;
      return;
    }

    // Seed history with analytically computed past states.
    // sampleDemoChargeStates handles all modes — single-charge returns length-1 array,
    // multi-charge modes return length-2 arrays with charges +1 and -1.
    const chargeSpecs0 = sampleDemoChargeStates(mode, 0);
    const config = configRef.current;
    const horizonSpeed = maxHistorySpeed(mode);
    // Use the furthest charge position for the horizon so two-charge modes keep
    // enough history for both sources.
    const seedPos = chargeSpecs0[0].state.pos;
    const historyWindow = Math.max(
      ...chargeSpecs0.map(({ state }) => maxCornerDist(state.pos, db)),
      maxCornerDist(seedPos, db),
    ) / (config.c - horizonSpeed);
    const n = Math.ceil(historyWindow / 0.05);

    const runtimes: ChargeRuntime[] = chargeSpecs0.map(({ charge }) => ({
      history: new ChargeHistory(),
      charge,
    }));
    for (let i = -n; i <= 0; i++) {
      const states = sampleDemoChargeStates(mode, i * 0.05);
      for (let ci = 0; ci < runtimes.length; ci++) {
        runtimes[ci].history.recordState(states[ci].state);
      }
    }

    chargeRuntimesRef.current = runtimes;
    hasSeededRef.current = true;
  }, [resetCamera]);

  // Effect A — initial seed.
  useEffect(() => {
    if (defaultBounds === null) return;
    if (hasSeededRef.current) return;
    reseed(demoModeRef.current, defaultBounds);
  }, [defaultBounds, reseed]);

  // Effect B — mode-change reseed.
  // Skipped when handleDemoModeChange already called reseed() directly (start-panel
  // path with a mode change) — skipModeChangeReseedRef prevents the double-reseed.
  useEffect(() => {
    if (!hasSeededRef.current) return;
    if (skipModeChangeReseedRef.current) {
      skipModeChangeReseedRef.current = false;
      return;
    }
    const db = defaultBoundsRef.current;
    if (db === null) return;
    reseed(demoMode, db);
    ghostPosRef.current = null;
    // Resetting derived UI state after a mode-change reseed is a one-way update
    // (mode → reset) with no loop risk.
    setStopTriggered(false);
    setShowGhost(false);
    setMagneticHeatmapMode('off');
    setShowWavefrontContours(false);
    setShowStreamlines(false);
    setShowGhostStreamlines(false);
    isPausedRef.current = true;
    pendingStepRef.current = false;
    setIsPaused(true);
  }, [demoMode, reseed]);

  // ─── Moving charge handlers ──────────────────────────────────────────────────

  const handleStopNow = useCallback(() => {
    if (stopTriggerTimeRef.current !== null) return; // already stopped — one stop per session
    stopTriggerTimeRef.current = simTimeRef.current;
    setStopTriggered(true);
    if (showGhostRef.current) {
      ghostPosRef.current = { x: SUDDEN_STOP_V * simTimeRef.current, y: 0 };
    }
  }, []);

  const handleToggleGhost = useCallback(() => {
    const next = !showGhostRef.current;
    setShowGhost(next);
    if (next) {
      const T = stopTriggerTimeRef.current;
      ghostPosRef.current = T !== null
        ? { x: SUDDEN_STOP_V * simTimeRef.current, y: 0 }
        : null;
    } else {
      ghostPosRef.current = null;
    }
  }, []);

  // Rebuild the source history window from the current sim time after a c change.
  //
  // Only valid for analytic modes — the entire past
  // trajectory is closed-form, so any history window can be reconstructed exactly.
  //
  // Preserves: simTimeRef.current, stopTriggerTimeRef.current, demoMode.
  // Replaces:  historyRef.current (fresh ChargeHistory with correct window).
  // Increments: simEpochRef.current so paused canvases re-solve the current frame.
  const rebuildAnalyticHistoryAtCurrentTime = useCallback(
    (mode: 'moving_charge' | 'oscillating' | 'dipole' | 'hydrogen') => {
      const T      = simTimeRef.current;
      const config = configRef.current;     // already updated before this call
      const DT     = 0.05;                  // step spacing matches initial reseed

      // ── Multi-charge analytic modes: rebuild all charge histories simultaneously.
      if (mode === 'dipole' || mode === 'hydrogen') {
        const horizonSpeed = maxHistorySpeed(mode);
        const chargeStates0 = sampleDemoChargeStates(mode, T);
        const historyWindow = Math.max(
          ...chargeStates0.map(({ state }) => maxCornerDist(state.pos, viewBoundsRef.current)),
        ) / (config.c - horizonSpeed);
        const n = Math.ceil(historyWindow / DT);
        const newRuntimes: ChargeRuntime[] = chargeStates0.map(({ charge }) => ({
          charge,
          history: new ChargeHistory(),
        }));
        for (let i = -n; i <= 0; i++) {
          const states = sampleDemoChargeStates(mode, T + i * DT);
          for (let ci = 0; ci < newRuntimes.length; ci++) {
            newRuntimes[ci].history.recordState(states[ci].state);
          }
        }
        chargeRuntimesRef.current = newRuntimes;
        simEpochRef.current += 1;
        return;
      }

      // ── Single-charge (moving_charge, oscillating).
      const T_trig = stopTriggerTimeRef.current;

      // Current source position at T used to calculate the corner-to-source horizon.
      const currentPos = (mode === 'moving_charge' && T_trig !== null)
        ? sampleSuddenStopState(T, T_trig).pos
        : sampleSourceState(mode, T).pos;

      // Use peak speed (conservative mode-level bound) — same as the tick.
      const horizonSpeed  = maxHistorySpeed(mode);
      const historyWindow = maxCornerDist(currentPos, viewBoundsRef.current) / (config.c - horizonSpeed);
      const n             = Math.ceil(historyWindow / DT);

      const newHistory = new ChargeHistory();

      if (mode === 'moving_charge' && T_trig !== null) {
        // Post-stop: use sampleSuddenStopState for all steps and preserve braking
        // substeps so the acceleration-ramp shell edge stays sharp after a c change.
        for (let i = -n; i <= 0; i++) {
          const t     = T + i * DT;
          const tPrev = T + (i - 1) * DT;
          for (const tSub of brakingSubstepTimes(tPrev, t, T_trig)) {
            newHistory.recordState(sampleSuddenStopState(tSub, T_trig));
          }
          newHistory.recordState(sampleSuddenStopState(t, T_trig));
        }
      } else {
        // Pre-stop moving_charge or oscillating: closed-form past.
        for (let i = -n; i <= 0; i++) {
          newHistory.recordState(sampleSourceState(mode, T + i * DT));
        }
      }

      chargeRuntimesRef.current = [{ history: newHistory, charge: chargeRuntimesRef.current[0]?.charge ?? 1 }];
      simEpochRef.current += 1;
    },
    [], // stable: reads only from refs, no React state
  );

  const handleCChange = useCallback((rawC: number) => {
    // Enforce per-mode c minimum (Policy A conservative global minimum).
    // Prevents the causal horizon from exceeding the GPU history buffer for visible pixels.
    const mode = demoModeRef.current;
    const cMin = (mode === 'moving_charge' || mode === 'oscillating' || mode === 'dipole' || mode === 'hydrogen')
      ? minCForMode(mode)
      : 0.15;
    const newC = Math.max(cMin, rawC);
    configRef.current = { ...configRef.current, c: newC };
    setC(newC);

    // For analytic modes, immediately rebuild the history window for the new c.
    // The horizon is c-dependent: decreasing c widens it, and the existing buffer
    // may not reach far enough back — the solver would clamp to the oldest state
    // and produce a field inconsistent with the new speed of light.
    // Draggable history is accumulated from live drag events and is not analytically
    // reconstructible; it is left as-is and the tick adjusts the window on subsequent
    // frames via setMaxHistoryTime / pruneToWindow.
    if (mode === 'moving_charge' || mode === 'oscillating' || mode === 'dipole' || mode === 'hydrogen') {
      rebuildAnalyticHistoryAtCurrentTime(mode);
    }
  }, [rebuildAnalyticHistoryAtCurrentTime]);

  const handleDemoModeChange = useCallback((newMode: DemoMode) => {
    // When switching to a mode with a higher c minimum, bump c up before the reseed.
    if (newMode === 'moving_charge' || newMode === 'oscillating' || newMode === 'dipole' || newMode === 'hydrogen') {
      const cMin = minCForMode(newMode);
      if (configRef.current.c < cMin) {
        configRef.current = { ...configRef.current, c: cMin };
        setC(cMin);
      }
    }

    if (showStartPanelRef.current) {
      // Navigating from the start panel: always reseed (mode may be same as current,
      // so we can't rely on effect B, which only fires on state changes).
      // If the mode IS changing, effect B would also run — pre-empt it.
      if (newMode !== demoModeRef.current) {
        skipModeChangeReseedRef.current = true;
      }
      showStartPanelRef.current = false;
      setShowStartPanel(false);
      const db = defaultBoundsRef.current;
      if (db !== null) reseed(newMode, db);
      setDemoMode(newMode);
      ghostPosRef.current = null;
      setFieldLayer('total');
      setStopTriggered(false);
      setShowGhost(false);
      setMagneticHeatmapMode('off');
      setShowWavefrontContours(false);
      setShowStreamlines(false);
      setShowGhostStreamlines(false);
      isPausedRef.current = true;
      pendingStepRef.current = false;
      setIsPaused(true);
    } else {
      // Normal mode change: effect B handles the reseed.
      setDemoMode(newMode);
    }
  }, [reseed]);

  // Reset: reseed the current mode at t=0 and stay in the current mode.
  // Preserves all overlay choices (field layer, heatmap, contours, streamlines).
  // Resets only sim-derived state (stop trigger, ghost charge).
  const handleReset = useCallback(() => {
    // End any active drag.
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      rawDragPosRef.current = null;
      dragStateRef.current = stoppedDragState(dragStateRef.current?.pos ?? { x: 0, y: 0 });
      dragPeakSpeedRef.current = 0;
    }

    const db = defaultBoundsRef.current;
    if (db !== null) reseed(demoModeRef.current, db);

    // Reset sim-derived UI state only; overlay choices are preserved.
    setStopTriggered(false);
    setShowGhost(false);
    isPausedRef.current = true;
    pendingStepRef.current = false;
    if (dragCalloutTimerRef.current !== null) {
      clearTimeout(dragCalloutTimerRef.current);
      dragCalloutTimerRef.current = null;
    }
    setDragCalloutPos(null);
    setIsPaused(true);
  }, [reseed]);

  // Go to Start Screen: clears everything and returns to the mode-picker overlay.
  // Resets all overlay choices to initial settings.
  const handleGoToStartScreen = useCallback(() => {
    // End any active drag.
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      rawDragPosRef.current = null;
      dragStateRef.current = stoppedDragState(dragStateRef.current?.pos ?? { x: 0, y: 0 });
      dragPeakSpeedRef.current = 0;
    }

    // Clear simulation state — mode selection from the start panel will reseed.
    chargeRuntimesRef.current = [{ history: new ChargeHistory(), charge: 1 }];
    simTimeRef.current = 0;
    lastWallTimeRef.current = performance.now();
    simEpochRef.current += 1;
    stopTriggerTimeRef.current = null;
    ghostPosRef.current = null;
    reseedBoundsRef.current = null;

    resetCamera();

    // Reset all UI choices to initial settings.
    configRef.current = { ...configRef.current, c: 1.0 };
    setC(1.0);
    setFieldLayer('total');
    setStopTriggered(false);
    setShowGhost(false);
    setMagneticHeatmapMode('off');
    setShowWavefrontContours(false);
    setShowStreamlines(false);
    setShowGhostStreamlines(false);
    isPausedRef.current = true;
    pendingStepRef.current = false;
    if (dragCalloutTimerRef.current !== null) {
      clearTimeout(dragCalloutTimerRef.current);
      dragCalloutTimerRef.current = null;
    }
    setDragCalloutPos(null);
    setIsPaused(true);

    showStartPanelRef.current = true;
    setShowStartPanel(true);
  }, [resetCamera]);

  // ─── Simulation tick ────────────────────────────────────────────────────────

  useEffect(() => {
    function tick(wallTime: number) {
      rafRef.current = requestAnimationFrame(tick);

      if (!hasSeededRef.current) return;

      const rawDt = Math.min(wallTime - lastWallTimeRef.current, 50) / 1000;
      lastWallTimeRef.current = wallTime;

      const STEP_DT = 1 / 30;
      if (isPausedRef.current && !pendingStepRef.current) return;
      const dt = isPausedRef.current ? STEP_DT : rawDt;
      if (isPausedRef.current) pendingStepRef.current = false;

      simTimeRef.current += dt;

      const mode = demoModeRef.current;

      // ── Draggable branch: tick owns kinematics; returns early.
      if (mode === 'draggable') {
        const history = chargeRuntimesRef.current[0].history;
        const config = configRef.current;

        if (isDraggingRef.current && rawDragPosRef.current !== null) {
          dragStateRef.current = computeDragState(
            rawDragPosRef.current,
            dragStateRef.current,
            dt,
            config.c,
          );
          const speed = magnitude(dragStateRef.current.vel);
          if (speed > dragPeakSpeedRef.current) dragPeakSpeedRef.current = speed;
        } else if (!isDraggingRef.current && dragStateRef.current) {
          const finalPos = rawDragPosRef.current ?? dragStateRef.current.pos;
          rawDragPosRef.current = null;
          dragStateRef.current = stoppedDragState(finalPos);
        }

        if (!dragStateRef.current) return;

        const ds = dragStateRef.current;
        history.recordState({ pos: ds.pos, vel: ds.vel, accel: ds.accel, t: simTimeRef.current });

        const horizonSpeed = Math.min(dragPeakSpeedRef.current, config.c * 0.92);
        history.setMaxHistoryTime(
          maxCornerDist(ds.pos, viewBoundsRef.current) / (config.c - horizonSpeed)
        );
        history.pruneToWindow(simTimeRef.current);
        return;
      }

      // ── Multi-charge analytic branch: record all charge states simultaneously.
      if (mode === 'dipole' || mode === 'hydrogen') {
        const config = configRef.current;
        const runtimes = chargeRuntimesRef.current;
        const horizonSpeed = maxHistorySpeed(mode);
        const chargeStates = sampleDemoChargeStates(mode, simTimeRef.current);
        for (let ci = 0; ci < runtimes.length; ci++) {
          const { state } = chargeStates[ci];
          runtimes[ci].history.recordState(state);
          runtimes[ci].history.setMaxHistoryTime(
            maxCornerDist(state.pos, viewBoundsRef.current) / (config.c - horizonSpeed),
          );
          runtimes[ci].history.pruneToWindow(simTimeRef.current);
        }
        return;
      }

      // ── Compute source state (moving_charge and oscillating).
      // moving_charge records substeps for every transition ramp overlapping this frame.
      const history = chargeRuntimesRef.current[0].history;
      const config = configRef.current;
      let sourceState;

      if (mode === 'moving_charge') {
        const T_trig = stopTriggerTimeRef.current;
        const prevSimTime = simTimeRef.current - dt;

        if (T_trig === null) {
          sourceState = sampleSourceState('moving_charge', simTimeRef.current);
        } else {
          for (const tSub of brakingSubstepTimes(prevSimTime, simTimeRef.current, T_trig)) {
            history.recordState(sampleSuddenStopState(tSub, T_trig));
          }
          sourceState = sampleSuddenStopState(simTimeRef.current, T_trig);
          if (showGhostRef.current) {
            ghostPosRef.current = { x: SUDDEN_STOP_V * simTimeRef.current, y: 0 };
          }
        }
      } else {
        sourceState = sampleSourceState(mode, simTimeRef.current);
      }

      // ── Auto-reseed check.
      // Compares against reseedBoundsRef (source-centered snapshot) — camera panning
      // never triggers a reseed. Applies to modes where the charge can drift off-screen.
      // moving_charge pre-trigger is included because the charge moves at constant velocity.
      const shouldCheckReseed =
        (mode === 'moving_charge' && stopTriggerTimeRef.current === null) ||
        mode === 'oscillating';

      if (shouldCheckReseed && reseedBoundsRef.current !== null) {
        if (!isWithinBounds(sourceState.pos, reseedBoundsRef.current, 1.0)) {
          reseed(mode, defaultBoundsRef.current!);
          return;
        }
      }

      // ── Record state (sudden_stop substeps already recorded above for post-trigger).
      history.recordState(sourceState);

      const horizonSpeed = maxHistorySpeed(mode);
      history.setMaxHistoryTime(
        maxCornerDist(sourceState.pos, viewBoundsRef.current) / (config.c - horizonSpeed)
      );
      history.pruneToWindow(simTimeRef.current);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reseed]);

  // ─── Event wiring ───────────────────────────────────────────────────────────

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      handleGlobalPointerMove(e);
      if (isDraggingRef.current && demoModeRef.current === 'draggable') {
        if (isPausedRef.current) return;
        const worldPos = getWorldFromClientPoint(e.clientX, e.clientY);
        if (worldPos !== null) rawDragPosRef.current = worldPos;
      }
    };
    const onUp = (e: PointerEvent) => {
      handleGlobalPointerUp();
      if (e.button === 0 && isDraggingRef.current) {
        isDraggingRef.current = false;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [handleGlobalPointerMove, handleGlobalPointerUp, getWorldFromClientPoint]);

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
  }, [zoomAtClientPoint]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      beginPan(e.clientX, e.clientY);
      return;
    }
    if (e.button === 0 && demoModeRef.current === 'draggable') {
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const chargePos = dragStateRef.current?.pos ?? { x: 0, y: 0 };
      const cp = worldToScreen(chargePos, viewBoundsRef.current, rect.width, rect.height);

      if (hitTestCharge(cx, cy, cp.x, cp.y)) {
        if (isPausedRef.current) {
          // Show transient callout anchored to the charge's screen position.
          if (dragCalloutTimerRef.current !== null) clearTimeout(dragCalloutTimerRef.current);
          setDragCalloutPos({ x: cp.x, y: cp.y });
          dragCalloutTimerRef.current = setTimeout(() => {
            setDragCalloutPos(null);
            dragCalloutTimerRef.current = null;
          }, 1200);
          return;
        }
        e.preventDefault();
        isDraggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  }, [beginPan]);

  // ─── Cursor readout ─────────────────────────────────────────────────────────

  const readout = useCursorReadout({
    canvasRef,
    chargeRuntimesRef,
    simTimeRef,
    simEpochRef,
    configRef,
    viewBoundsRef,
    getWorldFromClientPoint,
  });

  // ─── Render ─────────────────────────────────────────────────────────────────

  // c-slider lower bound.
  // Multi-charge modes use the GPU-history bound regardless of WebGL availability.
  // For moving_charge and oscillating the GPU bound is stricter than the physics bound,
  // so it only applies when WebGL is active.
  const cMin =
    (demoMode === 'dipole' || demoMode === 'hydrogen') ? minCForMode(demoMode) :
    webGLReady === true && (demoMode === 'moving_charge' || demoMode === 'oscillating') ? minCForMode(demoMode) :
    0.65;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#0d0d12]"
      style={demoMode === 'draggable' ? { cursor: 'crosshair' } : undefined}
      onPointerDown={handlePointerDown}
      onContextMenu={e => e.preventDefault()}
    >
      <StreamlineCanvas
        chargeRuntimesRef={chargeRuntimesRef}
        simulationTimeRef={simTimeRef}
        configRef={configRef}
        simEpochRef={simEpochRef}
        isPausedRef={isPausedRef}
        bounds={viewBounds}
        showStreamlines={showStreamlines}
        showGhostStreamlines={showGhostStreamlines}
        ghostPosRef={ghostPosRef}
        ghostVel={demoMode === 'moving_charge' ? { x: SUDDEN_STOP_V, y: 0 } : undefined}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 17 }}
      />
      {(demoMode === 'moving_charge' || demoMode === 'oscillating' || demoMode === 'dipole' || demoMode === 'hydrogen' || demoMode === 'draggable') && (
        webGLReady === true ? (
          // WebGL path: per-pixel retarded-time solve for heatmap-capable modes.
          // WavefrontWebGLCanvas supports up to MAX_CHARGES=2 independent histories,
          // so the two-charge scripted modes route here alongside single-charge modes.
          <WavefrontWebGLCanvas
            chargeRuntimesRef={chargeRuntimesRef}
            simulationTimeRef={simTimeRef}
            configRef={configRef}
            simEpochRef={simEpochRef}
            bounds={viewBounds}
            demoMode={demoMode}
            heatmapChannel={magneticHeatmapMode}
            showContours={showWavefrontContours}
            isPausedRef={isPausedRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
          />
        ) : webGLReady === false ? (
          <>
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20
                            bg-black/70 text-gray-400 text-xs px-3 py-1 rounded
                            pointer-events-none select-none">
              High-fidelity heatmap requires GPU acceleration — running in lower-fidelity mode.
            </div>
            <WavefrontOverlayCanvas
              chargeRuntimesRef={chargeRuntimesRef}
              simulationTimeRef={simTimeRef}
              configRef={configRef}
              simEpochRef={simEpochRef}
              bounds={viewBounds}
              demoMode={demoMode}
              heatmapChannel={magneticHeatmapMode}
              showContours={showWavefrontContours}
              isPausedRef={isPausedRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
            />
          </>
        ) : null  /* detecting */
      )}
      <VectorFieldCanvas
        chargeRuntimesRef={chargeRuntimesRef}
        simulationTimeRef={simTimeRef}
        configRef={configRef}
        simEpochRef={simEpochRef}
        bounds={viewBounds}
        fieldLayer={fieldLayer}
        showVelocityVectors={showVelocityVectors}
        isPanning={isPanning}
        isPausedRef={isPausedRef}
        ghostPosRef={ghostPosRef}
        externalCanvasRef={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 15 }}
      />
      {dragCalloutPos !== null && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1.5 text-xs text-orange-200 shadow-lg"
          style={{ left: dragCalloutPos.x, top: dragCalloutPos.y - 40 }}
        >
          Click Run to enable dragging.
        </div>
      )}
      <ControlPanel
        demoMode={demoMode}
        fieldLayer={fieldLayer}
        isPaused={isPaused}
        c={c}
        stopTriggered={stopTriggered}
        readout={readout}
        magneticHeatmapMode={magneticHeatmapMode}
        showWavefrontContours={showWavefrontContours}
        onDemoModeChange={handleDemoModeChange}
        onFieldLayerChange={setFieldLayer}
        onPauseToggle={togglePause}
        onStepForward={stepForward}
        onReset={handleReset}
        onGoToStartScreen={handleGoToStartScreen}
        onCChange={handleCChange}
        onResetView={resetCamera}
        onZoomIn={() => zoomAtCenter(zoom * 1.5)}
        onZoomOut={() => zoomAtCenter(zoom / 1.5)}
        onPanLeft={() => panBy(-PAN_STEP_PX, 0)}
        onPanRight={() => panBy(PAN_STEP_PX, 0)}
        onPanUp={() => panBy(0, -PAN_STEP_PX)}
        onPanDown={() => panBy(0, PAN_STEP_PX)}
        onMagneticHeatmapModeChange={setMagneticHeatmapMode}
        onWavefrontContoursToggle={() => setShowWavefrontContours(v => !v)}
        showStreamlines={showStreamlines}
        onStreamlinesToggle={() => setShowStreamlines(v => !v)}
        showVelocityVectors={showVelocityVectors}
        onVelocityVectorsToggle={() => setShowVelocityVectors(v => !v)}
        cMin={cMin}
        noModeActive={showStartPanel}
      />
      {showStartPanel && (
        <StartPanel onSelectMode={handleDemoModeChange} />
      )}
      {demoMode === 'moving_charge' && !showStartPanel && (
        <MovingChargeMiniPanel
          stopTriggered={stopTriggered}
          showGhost={showGhost}
          showGhostStreamlines={showGhostStreamlines}
          onStopNow={handleStopNow}
          onToggleGhost={handleToggleGhost}
          onToggleGhostStreamlines={() => setShowGhostStreamlines(v => !v)}
          pos={miniPanelPos}
          onPosChange={setMiniPanelPos}
        />
      )}
    </div>
  );
}

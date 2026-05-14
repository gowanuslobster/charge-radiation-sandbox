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
  type StoppableMode,
  sampleSourceState,
  sampleDemoChargeStates,
  sampleStoppedDemoChargeStates,
  maxHistorySpeed,
  brakingSubstepTimes,
  SUDDEN_STOP_V,
} from '@/physics/demoModes';
import { recordStoppedFrame } from '@/physics/stoppedFrame';
import type { FieldLayer, MagneticHeatmapMode } from '@/rendering/displayModes';
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
import { useFieldProbe } from './useFieldProbe';
import { FieldProbePanel } from './FieldProbePanel';
import { StartPanel } from './StartPanel';
import { isWithinBounds, maxCornerDist, worldToScreen, type WorldBounds } from '@/rendering/worldSpace';
import { hitTestCharge } from '@/rendering/chargeHitTest';

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
  //
  // Dev-only debug override: appending ?forceFallback=1 to the URL forces
  // webGLReady = false so the CPU WavefrontOverlayCanvas path renders even on
  // hardware that supports WebGL. Used to verify fallback-path correctness
  // (period table, signed-contour predicate, etc.) without hardware that lacks
  // WebGL2 + RGBA32F. Gated behind import.meta.env.DEV; never active in
  // production builds.
  const [webGLReady, setWebGLReady] = useState<boolean | null>(null);
  useEffect(() => {
    const forceFallback = import.meta.env.DEV
      && typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('forceFallback') === '1';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (forceFallback) { setWebGLReady(false); return; }

    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
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

  // ─── Field probe ────────────────────────────────────────────────────────────

  const probe = useFieldProbe({
    chargeRuntimesRef,
    simTimeRef,
    simEpochRef,
    configRef,
  });

  // Default top-right; persists across mode changes within a session.
  const [probePanelPos, setProbePanelPos] = useState(() => ({
    x: Math.max(0, window.innerWidth - 320),
    y: 96,
  }));

  // Container size for screen-space marker placement.
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Click-to-place: ignore drags (browser suppresses click after drag motion),
  // ignore clicks while the start panel is up (only the mode cards should be
  // actionable then), ignore clicks on the active charge in draggable mode,
  // otherwise drop a probe.
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (showStartPanelRef.current) return;
    if (isDraggingRef.current) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (demoModeRef.current === 'draggable') {
      const chargePos = dragStateRef.current?.pos ?? { x: 0, y: 0 };
      const cp = worldToScreen(chargePos, viewBoundsRef.current, rect.width, rect.height);
      if (hitTestCharge(cx, cy, cp.x, cp.y)) return;
    }
    const worldPos = getWorldFromClientPoint(e.clientX, e.clientY);
    if (worldPos === null) return;
    probe.setPosition(worldPos);
  }, [getWorldFromClientPoint, probe]);

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
  // Only valid for analytic modes — the entire past trajectory is closed-form,
  // so any history window can be reconstructed exactly. Handles pre-trigger and
  // post-trigger uniformly via sampleStoppedDemoChargeStates, which falls back
  // to the original analytic state when t < T_trig (so the seed loop can walk
  // back across the trigger boundary safely).
  //
  // Preserves: simTimeRef.current, stopTriggerTimeRef.current, demoMode.
  // Replaces:  chargeRuntimesRef.current (fresh ChargeHistory per charge).
  // Increments: simEpochRef.current so paused canvases re-solve the current frame.
  const rebuildAnalyticHistoryAtCurrentTime = useCallback(
    (mode: StoppableMode) => {
      const T      = simTimeRef.current;
      const config = configRef.current;     // already updated before this call
      const DT     = 0.05;                  // step spacing matches initial reseed
      const T_trig = stopTriggerTimeRef.current;

      // Sampler unifies pre-stop and post-stop paths. Per-mode-family analytic
      // forms cover all three phases of every stoppable mode.
      const sample = T_trig !== null
        ? (t: number) => sampleStoppedDemoChargeStates(mode, t, T_trig)
        : (t: number) => sampleDemoChargeStates(mode, t);

      // Current per-charge states drive horizon distance (uses the post-stop
      // resting position for multi-charge modes after a trigger). The horizon
      // speed budget is still maxHistorySpeed(mode) — the pre-stop peak —
      // because outside-shell observers need pre-trigger history retained.
      const chargeStates0 = sample(T);
      const horizonSpeed  = maxHistorySpeed(mode);
      const historyWindow = Math.max(
        ...chargeStates0.map(({ state }) => maxCornerDist(state.pos, viewBoundsRef.current)),
      ) / (config.c - horizonSpeed);
      const n = Math.ceil(historyWindow / DT);

      const newRuntimes: ChargeRuntime[] = chargeStates0.map(({ charge }) => ({
        charge,
        history: new ChargeHistory(),
      }));

      // Walk back through the history window. For each backward DT step also
      // emit braking substeps when this step's interval straddles the brake
      // window (boundary anchors + interior substeps). This preserves the
      // radiation-shell sharpness after a c-change rebuild — same role as the
      // substeps in the live tick.
      for (let i = -n; i <= 0; i++) {
        const t     = T + i * DT;
        const tPrev = T + (i - 1) * DT;
        if (T_trig !== null) {
          for (const tSub of brakingSubstepTimes(tPrev, t, T_trig)) {
            const subStates = sample(tSub);
            for (let ci = 0; ci < newRuntimes.length; ci++) {
              newRuntimes[ci].history.recordState(subStates[ci].state);
            }
          }
        }
        const states = sample(t);
        for (let ci = 0; ci < newRuntimes.length; ci++) {
          newRuntimes[ci].history.recordState(states[ci].state);
        }
      }

      chargeRuntimesRef.current = newRuntimes;
      simEpochRef.current += 1;
    },
    [], // stable: reads only from refs, no React state
  );

  const handleCChange = useCallback((rawC: number) => {
    // Enforce per-mode c minimum (Policy A conservative global minimum).
    // Prevents the causal horizon from exceeding the GPU history buffer for visible pixels.
    const mode = demoModeRef.current;
    const cMin = (mode === 'moving_charge' || mode === 'oscillating' || mode === 'dipole' || mode === 'hydrogen' || mode === 'water_stretch' || mode === 'water_bend' || mode === 'water_asym_stretch')
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
    if (mode === 'moving_charge' || mode === 'oscillating' || mode === 'dipole' || mode === 'hydrogen' || mode === 'water_stretch' || mode === 'water_bend' || mode === 'water_asym_stretch') {
      rebuildAnalyticHistoryAtCurrentTime(mode);
    }
  }, [rebuildAnalyticHistoryAtCurrentTime]);

  const handleDemoModeChange = useCallback((newMode: DemoMode) => {
    // When switching to a mode with a higher c minimum, bump c up before the reseed.
    if (newMode === 'moving_charge' || newMode === 'oscillating' || newMode === 'dipole' || newMode === 'hydrogen' || newMode === 'water_stretch' || newMode === 'water_bend' || newMode === 'water_asym_stretch') {
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
      probe.clear();
    } else {
      // Normal mode change: effect B handles the reseed.
      setDemoMode(newMode);
      probe.clear();
    }
  }, [reseed, probe]);

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
    probe.clear();
  }, [reseed, probe]);

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
    probe.clear();
  }, [resetCamera, probe]);

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

      // ── Stop-aware branch ────────────────────────────────────────────────
      // Once Stop now has fired in any stoppable mode, the unified post-trigger
      // dispatch handles substep + current recording for every charge. Placed
      // before the per-mode pre-stop branches because multi-charge modes
      // (dipole, hydrogen, water_*) would otherwise early-return through the
      // pre-stop analytic branch below and miss the brake.
      // mode is narrowed to StoppableMode here (draggable returned above).
      const T_trig = stopTriggerTimeRef.current;
      if (T_trig !== null) {
        const prevSimTime = simTimeRef.current - dt;
        recordStoppedFrame(
          chargeRuntimesRef.current,
          mode,
          prevSimTime,
          simTimeRef.current,
          T_trig,
          viewBoundsRef.current,
          configRef.current,
        );
        // moving_charge ghost overlay (only visible in moving_charge mode):
        // marker tracks the would-have-been position of the still-moving charge.
        if (mode === 'moving_charge' && showGhostRef.current) {
          ghostPosRef.current = { x: SUDDEN_STOP_V * simTimeRef.current, y: 0 };
        }
        return;
      }

      // ── Multi-charge analytic branch (pre-stop): record all charge states.
      if (mode === 'dipole' || mode === 'hydrogen' || mode === 'water_stretch' || mode === 'water_bend' || mode === 'water_asym_stretch') {
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

      // ── Single-charge analytic branch (pre-stop): moving_charge and oscillating.
      const history = chargeRuntimesRef.current[0].history;
      const config = configRef.current;
      const sourceState = sampleSourceState(mode, simTimeRef.current);

      // Auto-reseed: applies to translation-style modes where the charge can drift
      // off the source-centered snapshot. Camera panning never triggers a reseed.
      if (reseedBoundsRef.current !== null) {
        if (!isWithinBounds(sourceState.pos, reseedBoundsRef.current, 1.0)) {
          reseed(mode, defaultBoundsRef.current!);
          return;
        }
      }

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

  // Probe marker screen position (recomputed on viewBounds / containerSize / probe move).
  const probeScreenPos = probe.position !== null && containerSize.w > 0
    ? worldToScreen(probe.position, viewBounds, containerSize.w, containerSize.h)
    : null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  // c-slider lower bound.
  // Multi-charge modes (dipole, hydrogen, water_stretch, water_bend,
  // water_asym_stretch) use the GPU-history bound regardless of WebGL
  // availability. For moving_charge and oscillating the GPU bound is stricter
  // than the physics bound, so it only applies when WebGL is active.
  const cMin =
    (demoMode === 'dipole' || demoMode === 'hydrogen' || demoMode === 'water_stretch' || demoMode === 'water_bend' || demoMode === 'water_asym_stretch') ? minCForMode(demoMode) :
    webGLReady === true && (demoMode === 'moving_charge' || demoMode === 'oscillating') ? minCForMode(demoMode) :
    0.65;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#0d0d12]"
      style={demoMode === 'draggable' ? { cursor: 'crosshair' } : undefined}
      onPointerDown={handlePointerDown}
      onClick={handleContainerClick}
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
        demoMode={demoMode}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 17 }}
      />
      {(demoMode === 'moving_charge' || demoMode === 'oscillating' || demoMode === 'dipole' || demoMode === 'hydrogen' || demoMode === 'draggable' || demoMode === 'water_stretch' || demoMode === 'water_bend' || demoMode === 'water_asym_stretch') && (
        webGLReady === true ? (
          // WebGL path: per-pixel retarded-time solve for heatmap-capable modes.
          // WavefrontWebGLCanvas supports up to MAX_CHARGES=32 independent histories
          // (M14-A.2: family-ready bump from 2 to cover M14 water modes at N=3 and
          // any future small-molecule modes).
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
        onStopNow={handleStopNow}
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
      {probeScreenPos !== null && (
        <svg
          className="pointer-events-none absolute inset-0"
          style={{ zIndex: 18 }}
          width={containerSize.w}
          height={containerSize.h}
        >
          <circle
            cx={probeScreenPos.x}
            cy={probeScreenPos.y}
            r={10}
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={1.4}
            strokeDasharray="4 4"
          />
          <line
            x1={probeScreenPos.x - 14}
            x2={probeScreenPos.x + 14}
            y1={probeScreenPos.y}
            y2={probeScreenPos.y}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={1}
          />
          <line
            x1={probeScreenPos.x}
            x2={probeScreenPos.x}
            y1={probeScreenPos.y - 14}
            y2={probeScreenPos.y + 14}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={1}
          />
        </svg>
      )}
      {!showStartPanel && probe.position !== null && (
        <FieldProbePanel
          position={probe.position}
          channel={probe.channel}
          instant={probe.instant}
          displaySamples={probe.displaySamples}
          onChannelChange={probe.setChannel}
          onClear={probe.clear}
          pos={probePanelPos}
          onPosChange={setProbePanelPos}
        />
      )}
      {showStartPanel && (
        <StartPanel onSelectMode={handleDemoModeChange} />
      )}
      {demoMode === 'moving_charge' && !showStartPanel && (
        <MovingChargeMiniPanel
          showGhost={showGhost}
          showGhostStreamlines={showGhostStreamlines}
          onToggleGhost={handleToggleGhost}
          onToggleGhostStreamlines={() => setShowGhostStreamlines(v => !v)}
          pos={miniPanelPos}
          onPosChange={setMiniPanelPos}
        />
      )}
    </div>
  );
}

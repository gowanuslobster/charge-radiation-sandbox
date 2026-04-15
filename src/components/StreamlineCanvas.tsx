// StreamlineCanvas — paused-frame field-line overlay (M9).
//
// Renders streamlines of the instantaneous LW electric field when the
// simulation is paused. Streamlines are traced on demand (once per paused
// frame when the overlay is toggled on) and reused until the frame, epoch,
// or visibility changes. The canvas stays clear during normal playback —
// no physics is evaluated while the simulation is running.
//
// Two independent overlays:
//   Main streamlines  — total LW E field (velocity + acceleration terms).
//   Ghost streamlines — velocity-field E only (eVel), from a synthetic ghost
//                       history. Only active in moving_charge mode when the
//                       ghost overlay is enabled.
//
// Visual style: matches field-sandbox FieldLinesCanvas static_arrows mode.
// Thin polylines with soft blue glow for main lines; warm gold for ghost lines.
// Direction tick-marks are spaced at 155 px to indicate field orientation.
//
// Performance note: a single retrace is O(seedCount × maxSteps × LW solves).
// With defaults (16 seeds × 350 steps × 4 RK4 substeps) this is a one-time
// synchronous cost on the first paused frame or when inputs change. The cost
// is acceptable because tracing is strictly paused-only.

import {
  useEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  buildStreamlines,
  buildGhostHistory,
  deriveGhostSeedAnglesFromRealLines,
} from '@/physics/streamlineTracer';
import type { ChargeHistory } from '@/physics/chargeHistory';
import {
  getWorldToScreenTransform,
  transformWorldPoint,
  maxCornerDist,
  type WorldBounds,
} from '@/rendering/worldSpace';
import type { SimConfig, Vec2 } from '@/physics/types';
import { magnitude } from '@/physics/vec2';

type Props = {
  historyRef: RefObject<ChargeHistory>;
  simulationTimeRef: RefObject<number>;
  chargeRef: RefObject<number>;
  configRef: RefObject<SimConfig>;
  simEpochRef?: RefObject<number>;
  isPausedRef: RefObject<boolean>;
  /** React prop — re-renders when camera changes, letting boundsRef pick up the new value. */
  bounds: WorldBounds;
  showStreamlines: boolean;
  showGhostStreamlines: boolean;
  ghostPosRef?: RefObject<Vec2 | null>;
  /** Constant velocity of the ghost charge, used to build its synthetic history. */
  ghostVel?: Vec2;
  style?: CSSProperties;
};

// Visual constants — matched to field-sandbox FieldLinesCanvas static_arrows mode.
const LINE_ALPHA       = 0.65;
const GHOST_LINE_ALPHA = 0.35; // dimmer than main lines to read as secondary/hypothetical
const LINE_WIDTH = 1.2;
const SHADOW_BLUR = 8;
const LINE_COLOR_MAIN  = `rgba(198, 229, 255, ${LINE_ALPHA})`;
const LINE_COLOR_GHOST = `rgba(255, 200, 130, ${GHOST_LINE_ALPHA})`;
const SHADOW_COLOR_MAIN  = 'rgba(112, 214, 255, 0.35)';
const SHADOW_COLOR_GHOST = 'rgba(255, 160,  60, 0.18)';
// Dash pattern for ghost lines: subtle short dashes so they read as
// "extrapolated / hypothetical" rather than physically present field lines.
const GHOST_DASH: number[] = [4, 5];

/**
 * Place direction tick-marks along a screen-space polyline.
 * Spacing and arrowhead geometry match field-sandbox's drawDirectionArrows.
 */
function drawDirectionTicks(
  ctx: CanvasRenderingContext2D,
  screenPoints: Vec2[],
): void {
  if (screenPoints.length < 2) return;

  const SPACING_PX    = 155;
  const HEAD_LEN      = 4.5;
  const WING_ANGLE    = 0.58; // radians — matches field-sandbox
  let distSinceArrow  = SPACING_PX * 0.5; // offset start so first tick isn't at the seed
  let arrowsPlaced    = 0;
  const MAX_ARROWS    = 3;

  for (let i = 0; i < screenPoints.length - 1 && arrowsPlaced < MAX_ARROWS; i++) {
    const a = screenPoints[i];
    const b = screenPoints[i + 1];
    const sdx = b.x - a.x;
    const sdy = b.y - a.y;
    const segLen = Math.hypot(sdx, sdy);
    if (segLen < 1e-4) continue;

    let segProgress = 0;
    while (distSinceArrow + (segLen - segProgress) >= SPACING_PX && arrowsPlaced < MAX_ARROWS) {
      const remaining = SPACING_PX - distSinceArrow;
      const t = (segProgress + remaining) / segLen;
      if (t >= 0 && t <= 1) {
        const tipX = a.x + sdx * t;
        const tipY = a.y + sdy * t;
        const angle = Math.atan2(sdy, sdx);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - HEAD_LEN * Math.cos(angle - WING_ANGLE),
          tipY - HEAD_LEN * Math.sin(angle - WING_ANGLE),
        );
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - HEAD_LEN * Math.cos(angle + WING_ANGLE),
          tipY - HEAD_LEN * Math.sin(angle + WING_ANGLE),
        );
        ctx.stroke();
        arrowsPlaced++;
      }
      segProgress += remaining;
      distSinceArrow = 0;
    }
    distSinceArrow += segLen - segProgress;
  }
}

/**
 * Project world-space points to screen and draw the polyline + direction ticks.
 * Pass a non-empty `dash` array to draw a dashed line (e.g. ghost streamlines).
 */
function drawStreamline(
  ctx: CanvasRenderingContext2D,
  line: Vec2[],
  transform: ReturnType<typeof getWorldToScreenTransform>,
  color: string,
  dash: number[] = [],
): void {
  if (line.length < 2) return;

  // Project once and reuse for both the polyline and tick placement.
  const screenPoints: Vec2[] = line.map(p => transformWorldPoint(p, transform));

  ctx.strokeStyle = color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (let i = 1; i < screenPoints.length; i++) {
    ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]); // restore solid for tick-marks

  drawDirectionTicks(ctx, screenPoints);
}

export function StreamlineCanvas({
  historyRef,
  simulationTimeRef,
  chargeRef,
  configRef,
  simEpochRef,
  isPausedRef,
  bounds,
  showStreamlines,
  showGhostStreamlines,
  ghostPosRef,
  ghostVel,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mirror React props into refs so the long-lived RAF closure reads fresh values
  // without needing to restart the effect when props change.
  const boundsRef             = useRef(bounds);
  const showStreamlinesRef    = useRef(showStreamlines);
  const showGhostStreamlinesRef = useRef(showGhostStreamlines);
  const ghostVelRef           = useRef(ghostVel);

  useEffect(() => { boundsRef.current = bounds; },                       [bounds]);
  useEffect(() => { showStreamlinesRef.current = showStreamlines; },     [showStreamlines]);
  useEffect(() => { showGhostStreamlinesRef.current = showGhostStreamlines; }, [showGhostStreamlines]);
  useEffect(() => { ghostVelRef.current = ghostVel; },                   [ghostVel]);

  // Long-lived RAF loop with retrace-on-demand.
  // Empty dep array: reads all mutable state via refs; never restarts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId: number;

    // Traced geometry — world-space point arrays, reused across frames while paused.
    let tracedLines: Vec2[][]      = [];
    let tracedGhostLines: Vec2[][] = [];

    // Cache keys: retrace when any physics input changes.
    // Bounds span is also tracked: a significant zoom-out invalidates the cache
    // because the padded clip region at trace-time may no longer extend far enough.
    let lastEpoch   = -1;
    let lastSimTime = NaN;
    let lastShowSL  = false;
    let lastShowGSL = false;
    let lastGhostX  = NaN;
    let lastGhostY  = NaN;
    let lastSpanX   = 0;
    let lastSpanY   = 0;
    let lastC       = NaN;
    let lastCharge  = NaN;

    // DPR-aware canvas sizing.
    const ro = new ResizeObserver(() => {
      if (!canvas) return;
      const dpr  = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      canvas.width  = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    });
    ro.observe(canvas);

    function frame() {
      rafId = requestAnimationFrame(frame);
      if (!canvas) return;

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const showSL  = showStreamlinesRef.current;
      const showGSL = showGhostStreamlinesRef.current;

      // Not paused or nothing to show — clear and bail.
      const paused = isPausedRef.current;
      if (!paused || (!showSL && !showGSL)) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const simTime  = simulationTimeRef.current;
      const epoch    = simEpochRef?.current ?? 0;
      const ghostPos = ghostPosRef?.current ?? null;
      const gx = ghostPos?.x ?? NaN;
      const gy = ghostPos?.y ?? NaN;
      const currentBounds = boundsRef.current;
      const spanX = currentBounds.maxX - currentBounds.minX;
      const spanY = currentBounds.maxY - currentBounds.minY;
      const config  = configRef.current;
      const charge  = chargeRef.current;

      // Retrace when the physics snapshot or visibility changes.
      // Also retrace on significant zoom-out (>30% span increase) so lines
      // don't appear truncated at the edges of the newly-visible region.
      const spanExpandedLarge =
        lastSpanX > 0 && (
          (spanX - lastSpanX) / lastSpanX > 0.3 ||
          (spanY - lastSpanY) / lastSpanY > 0.3
        );

      const needsRetrace =
        epoch   !== lastEpoch   ||
        simTime !== lastSimTime ||
        showSL  !== lastShowSL  ||
        showGSL !== lastShowGSL ||
        gx !== lastGhostX       ||
        gy !== lastGhostY       ||
        spanExpandedLarge       ||
        config.c !== lastC      ||
        charge   !== lastCharge;

      if (needsRetrace) {
        const history = historyRef.current;

        let realLinesForGhost: Vec2[][] = [];
        const newest = history.isEmpty() ? null : history.newest()!;

        // Main streamlines — total LW E field at the paused frame.
        // When ghost lines are requested, also trace the real total-field lines
        // even if they are hidden. The ghost-line correspondence is derived from
        // the settled outer branch of those real streamlines.
        if ((showSL || showGSL) && newest !== null) {
          const computedMainLines = buildStreamlines(
            newest.pos,
            simTime,
            history,
            charge,
            config,
            currentBounds,
          );
          tracedLines = showSL ? computedMainLines : [];
          realLinesForGhost = computedMainLines;
        } else {
          tracedLines = [];
        }

        // Ghost streamlines — velocity field of the extrapolated constant-velocity charge.
        const gVel = ghostVelRef.current;
        if (showGSL && ghostPos !== null && gVel !== undefined) {
          // History window: worst-case retarded-time horizon for the ghost, accounting
          // for its speed. Ghost speed is always < c (contract from demoModes).
          const ghostSpeed  = magnitude(gVel);
          const safeGap     = Math.max(config.c - ghostSpeed, config.c * 0.05);
          const histWindow  = maxCornerDist(ghostPos, currentBounds) / safeGap;
          const ghostHistory = buildGhostHistory(ghostPos, gVel, simTime, histWindow);

          // Match each ghost line to the settled outer branch of a traced real
          // streamline, not to the idealized zero-thickness shell crossing.
          // The stop is finite-width in this sandbox, so anchoring at the shell
          // crossing makes the ghost lines lock on too early while the real line
          // is still turning through the acceleration band.
          const ghostAngles = newest !== null
            ? deriveGhostSeedAnglesFromRealLines(
                realLinesForGhost,
                newest.pos,
                ghostPos,
                gVel,
                simTime,
                history,
                charge,
                config,
              )
            : [];

          if (ghostAngles.length === 0) {
            tracedGhostLines = [];
          } else {
            tracedGhostLines = buildStreamlines(
              ghostPos,
              simTime,
              ghostHistory,
              charge,
              config,
              currentBounds,
              undefined,
              true, // velocityOnly — ghost represents constant-velocity, no radiation term
              ghostAngles,
            );
          }
        } else {
          tracedGhostLines = [];
        }

        lastEpoch   = epoch;
        lastSimTime = simTime;
        lastShowSL  = showSL;
        lastShowGSL = showGSL;
        lastGhostX  = gx;
        lastGhostY  = gy;
        lastSpanX   = spanX;
        lastSpanY   = spanY;
        lastC       = config.c;
        lastCharge  = charge;
      }

      // Draw to the DPR-scaled canvas.
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';

      const transform = getWorldToScreenTransform(currentBounds, cssW, cssH);

      if (showSL && tracedLines.length > 0) {
        ctx.shadowColor = SHADOW_COLOR_MAIN;
        ctx.shadowBlur  = SHADOW_BLUR;
        for (const line of tracedLines) {
          drawStreamline(ctx, line, transform, LINE_COLOR_MAIN);
        }
        ctx.shadowBlur = 0;
      }

      if (showGSL && tracedGhostLines.length > 0) {
        ctx.shadowColor = SHADOW_COLOR_GHOST;
        ctx.shadowBlur  = SHADOW_BLUR;
        for (const line of tracedGhostLines) {
          drawStreamline(ctx, line, transform, LINE_COLOR_GHOST, GHOST_DASH);
        }
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    }

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Empty dep array is intentional: all mutable inputs are read via refs inside
  // the RAF closure. Restarting the effect on every prop change would reset the
  // traced-line cache unnecessarily.

  return <canvas ref={canvasRef} style={style} />;
}

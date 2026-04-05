// Camera state and interaction hook for the sandbox viewport.
//
// Manages pan (right/middle drag) and zoom (scroll wheel) interactions.
// Pan offset commits are RAF-batched — at most one React state update per frame.
//
// CALLER RESPONSIBILITIES (document in usage site):
//   - Attach onWheel to container div (non-passive, via useEffect with addEventListener)
//   - Attach onPointerDown to container div for pan initiation
//   - Attach handleGlobalPointerMove and handleGlobalPointerUp to window via useEffect
//     so that pan continues when the pointer leaves the container
//   - Attach onContextMenu={e => e.preventDefault()} to suppress browser context menu
//
// Base bounds: aspect-aware, halfHeight = 4.0 world units, computed from the
// measured container size by an internal ResizeObserver.

import { useState, useRef, useCallback, useEffect, type RefObject } from 'react';
import { getViewBounds, screenToWorld, type WorldBounds } from '../rendering/worldSpace';
import type { Vec2 } from '../physics/types';

const HALF_HEIGHT = 4.0; // world units, half-height of the default view

type UseSandboxCameraOptions = {
  containerRef: RefObject<HTMLDivElement | null>;
  minZoom?: number; // default 0.25
  maxZoom?: number; // default 16
};

export type UseSandboxCameraResult = {
  /** Current view bounds (React state — triggers re-render when updated). */
  viewBounds: WorldBounds;
  /**
   * View bounds at zoom=1, offsetX=0, offsetY=0.
   * null before the container is first measured by the ResizeObserver.
   * Used by callers to compute history horizons and reseed bounds without
   * re-deriving base bounds themselves.
   */
  defaultBounds: WorldBounds | null;
  /** Current zoom level (React state). */
  zoom: number;
  isPanning: boolean;
  /** Convert a client-space point to world space. Returns null before first measurement. */
  getWorldFromClientPoint(clientX: number, clientY: number): Vec2 | null;
  /** Zoom to desiredZoom (absolute level) keeping the given client point fixed in world space. */
  zoomAtClientPoint(clientX: number, clientY: number, desiredZoom: number): void;
  /** Zoom to desiredZoom (absolute level) keeping the viewport center fixed. */
  zoomAtCenter(desiredZoom: number): void;
  beginPan(clientX: number, clientY: number): void;
  /** Returns true if this hook owns the event (pointer is currently panning). */
  handleGlobalPointerMove(event: PointerEvent): boolean;
  handleGlobalPointerUp(): void;
  /** Reset zoom=1, offsetX=0, offsetY=0 and publish updated viewBounds. */
  resetCamera(): void;
  /**
   * Shift the view by a discrete step given in CSS pixels.
   * Sign convention matches drag pan: positive screenDx shifts view left (world moves right);
   * positive screenDy shifts view up (world moves down on screen).
   */
  panBy(screenDx: number, screenDy: number): void;
};

export function useSandboxCamera({
  containerRef,
  minZoom = 0.25,
  maxZoom = 16,
}: UseSandboxCameraOptions): UseSandboxCameraResult {
  // Camera state lives in refs for synchronous reads inside RAF and event handlers.
  // React state (setViewBounds, setZoom) is published via publishViewBounds() to
  // trigger re-renders in components that consume these values.
  const zoomRef = useRef(1);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const baseBoundsRef = useRef<WorldBounds | null>(null);

  const [viewBounds, setViewBounds] = useState<WorldBounds>({ minX: -7, maxX: 7, minY: -4, maxY: 4 });
  const [defaultBounds, setDefaultBounds] = useState<WorldBounds | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  // Pan tracking
  const isPanningRef = useRef(false);
  const panStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const panStartOffsetRef = useRef({ x: 0, y: 0 });
  const pendingOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const commitRafRef = useRef<number | null>(null);

  /** Publish current camera state to React state (triggers re-renders). */
  const publishViewBounds = useCallback(() => {
    const base = baseBoundsRef.current;
    if (!base) return;
    const bounds = getViewBounds(base, {
      zoom: zoomRef.current,
      offsetX: offsetXRef.current,
      offsetY: offsetYRef.current,
    });
    setViewBounds(bounds);
    setZoom(zoomRef.current);
  }, []);

  // ResizeObserver: measures the container and computes base bounds.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;

      const halfWidth = HALF_HEIGHT * (width / height);
      const base: WorldBounds = {
        minX: -halfWidth,
        maxX: halfWidth,
        minY: -HALF_HEIGHT,
        maxY: HALF_HEIGHT,
      };
      baseBoundsRef.current = base;

      // defaultBounds = base at zoom=1, offset=0 (which equals base itself).
      setDefaultBounds(base);

      setViewBounds(
        getViewBounds(base, {
          zoom: zoomRef.current,
          offsetX: offsetXRef.current,
          offsetY: offsetYRef.current,
        })
      );
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef]);

  const getWorldFromClientPoint = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const container = containerRef.current;
      const base = baseBoundsRef.current;
      if (!container || !base) return null;

      const rect = container.getBoundingClientRect();
      const bounds = getViewBounds(base, {
        zoom: zoomRef.current,
        offsetX: offsetXRef.current,
        offsetY: offsetYRef.current,
      });
      return screenToWorld(
        { x: clientX - rect.left, y: clientY - rect.top },
        bounds,
        rect.width,
        rect.height
      );
    },
    [containerRef]
  );

  const zoomAtClientPoint = useCallback(
    (clientX: number, clientY: number, desiredZoom: number) => {
      const base = baseBoundsRef.current;
      const container = containerRef.current;
      if (!base || !container) return;

      const newZoom = Math.max(minZoom, Math.min(maxZoom, desiredZoom));
      const rect = container.getBoundingClientRect();

      // World point under cursor before the zoom.
      const oldBounds = getViewBounds(base, {
        zoom: zoomRef.current,
        offsetX: offsetXRef.current,
        offsetY: offsetYRef.current,
      });
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const wp = screenToWorld({ x: cx, y: cy }, oldBounds, rect.width, rect.height);

      // New span at the new zoom level.
      const baseSpanX = base.maxX - base.minX;
      const baseSpanY = base.maxY - base.minY;
      const baseCenterX = (base.minX + base.maxX) / 2;
      const baseCenterY = (base.minY + base.maxY) / 2;
      const newSpanX = baseSpanX / newZoom;
      const newSpanY = baseSpanY / newZoom;

      // Solve for new center such that wp maps back to (cx, cy).
      //   wp.x = newCenter.x + newSpanX * (cx / width − 0.5)
      //   wp.y = newCenter.y + newSpanY * (0.5 − cy / height)
      const newCenterX = wp.x - newSpanX * (cx / rect.width - 0.5);
      const newCenterY = wp.y - newSpanY * (0.5 - cy / rect.height);

      zoomRef.current = newZoom;
      offsetXRef.current = newCenterX - baseCenterX;
      offsetYRef.current = newCenterY - baseCenterY;
      publishViewBounds();
    },
    [containerRef, minZoom, maxZoom, publishViewBounds]
  );

  const beginPan = useCallback((clientX: number, clientY: number) => {
    isPanningRef.current = true;
    setIsPanning(true);
    panStartClientRef.current = { x: clientX, y: clientY };
    panStartOffsetRef.current = { x: offsetXRef.current, y: offsetYRef.current };
  }, []);

  const scheduleCommit = useCallback(() => {
    if (commitRafRef.current !== null) return;
    commitRafRef.current = requestAnimationFrame(() => {
      commitRafRef.current = null;
      const p = pendingOffsetRef.current;
      if (!p) return;
      pendingOffsetRef.current = null;
      offsetXRef.current = p.x;
      offsetYRef.current = p.y;
      publishViewBounds();
    });
  }, [publishViewBounds]);

  const handleGlobalPointerMove = useCallback(
    (event: PointerEvent): boolean => {
      if (!isPanningRef.current || !panStartClientRef.current) return false;
      const base = baseBoundsRef.current;
      const container = containerRef.current;
      if (!base || !container) return false;

      const rect = container.getBoundingClientRect();
      const spanX = (base.maxX - base.minX) / zoomRef.current;
      const spanY = (base.maxY - base.minY) / zoomRef.current;

      // Cursor delta from pan start in screen pixels.
      const dxPx = event.clientX - panStartClientRef.current.x;
      const dyPx = event.clientY - panStartClientRef.current.y;

      // Pan offsets such that the world point under the cursor at pan start stays
      // under the cursor at the current cursor position ("grab and drag the world"):
      //   newOffsetX = startOffsetX − dxPx * spanX / width
      //   newOffsetY = startOffsetY + dyPx * spanY / height
      //
      // X: drag right (dxPx > 0) → offsetX decreases → world content moves right on screen.
      // Y: drag down  (dyPx > 0) → offsetY increases → world center moves up (Y-flip),
      //    so content above the old center moves into view (world moves down on screen).
      pendingOffsetRef.current = {
        x: panStartOffsetRef.current.x - dxPx * spanX / rect.width,
        y: panStartOffsetRef.current.y + dyPx * spanY / rect.height,
      };
      scheduleCommit();
      return true;
    },
    [containerRef, scheduleCommit]
  );

  const handleGlobalPointerUp = useCallback((): void => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    setIsPanning(false);
    panStartClientRef.current = null;

    // Flush any pending offset immediately on pointer up.
    if (commitRafRef.current !== null) {
      cancelAnimationFrame(commitRafRef.current);
      commitRafRef.current = null;
    }
    const p = pendingOffsetRef.current;
    if (p) {
      pendingOffsetRef.current = null;
      offsetXRef.current = p.x;
      offsetYRef.current = p.y;
      publishViewBounds();
    }
  }, [publishViewBounds]);

  const zoomAtCenter = useCallback(
    (desiredZoom: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, desiredZoom);
    },
    [containerRef, zoomAtClientPoint]
  );

  const panBy = useCallback(
    (screenDx: number, screenDy: number) => {
      const base = baseBoundsRef.current;
      const container = containerRef.current;
      if (!base || !container) return;
      const rect = container.getBoundingClientRect();
      const spanX = (base.maxX - base.minX) / zoomRef.current;
      const spanY = (base.maxY - base.minY) / zoomRef.current;
      // Same sign convention as handleGlobalPointerMove.
      offsetXRef.current -= screenDx * spanX / rect.width;
      offsetYRef.current += screenDy * spanY / rect.height;
      publishViewBounds();
    },
    [containerRef, publishViewBounds]
  );

  const resetCamera = useCallback(() => {
    zoomRef.current = 1;
    offsetXRef.current = 0;
    offsetYRef.current = 0;
    publishViewBounds();
  }, [publishViewBounds]);

  return {
    viewBounds,
    defaultBounds,
    zoom,
    isPanning,
    getWorldFromClientPoint,
    zoomAtClientPoint,
    zoomAtCenter,
    beginPan,
    handleGlobalPointerMove,
    handleGlobalPointerUp,
    resetCamera,
    panBy,
  };
}

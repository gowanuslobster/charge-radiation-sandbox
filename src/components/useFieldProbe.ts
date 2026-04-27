// useFieldProbe — RAF-batched LW field sampling at a fixed world position.
//
// The probe samples all six channels (Ex, Ey, |E|, Bz, BzVel, BzAccel) every
// time it advances, so switching channels never clears history — the panel
// just redraws from a different ring buffer.
//
// State model:
//   • One sample per RAF tick whenever simTime, sim epoch, c, or position
//     changes. While paused the simulation tick freezes simTime, so the loop
//     short-circuits naturally.
//   • Position changes reset the ring buffer and force a fresh sample.
//   • Sim epoch (reseed/mode change) and c changes reset the ring buffer in
//     place but keep the probe position — the parent owns whether to clear
//     the probe entirely (e.g. mode change calls `clear()` directly).
//
// Display contract: `displaySamples` is oldest-to-newest, length grows from 0
// up to PROBE_HISTORY_LEN, then stays clamped while older samples evict.

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import type { ChargeRuntime } from '@/physics/chargeRuntime';
import type { SimConfig, Vec2 } from '@/physics/types';
import { evaluateSuperposedLienardWiechertField } from '@/physics/lienardWiechert';
import {
  type ProbeChannel,
  PROBE_CHANNELS,
  DEFAULT_PROBE_CHANNEL,
  getProbeChannelValue,
} from '@/physics/probeChannel';

export const PROBE_HISTORY_LEN = 256;

export type ProbeInstant = Record<ProbeChannel, number>;

export type FieldProbe = {
  position: Vec2 | null;
  channel: ProbeChannel;
  instant: ProbeInstant | null;
  /** Oldest-to-newest samples for the active channel. Length ≤ PROBE_HISTORY_LEN. */
  displaySamples: Float32Array;
  setPosition: (pos: Vec2) => void;
  setChannel: (channel: ProbeChannel) => void;
  clear: () => void;
};

interface UseFieldProbeOptions {
  chargeRuntimesRef: RefObject<ChargeRuntime[]>;
  simTimeRef:        RefObject<number>;
  simEpochRef:       RefObject<number>;
  configRef:         RefObject<SimConfig>;
}

type ChannelBuffers = Record<ProbeChannel, Float32Array>;

function makeBuffers(): ChannelBuffers {
  return {
    Ex:      new Float32Array(PROBE_HISTORY_LEN),
    Ey:      new Float32Array(PROBE_HISTORY_LEN),
    Emag:    new Float32Array(PROBE_HISTORY_LEN),
    Bz:      new Float32Array(PROBE_HISTORY_LEN),
    BzVel:   new Float32Array(PROBE_HISTORY_LEN),
    BzAccel: new Float32Array(PROBE_HISTORY_LEN),
  };
}

// Copy the active channel's ring buffer into a flat oldest-to-newest array.
function snapshotBuffer(buf: Float32Array, writeIdx: number, filled: number): Float32Array {
  if (filled === 0) return new Float32Array(0);
  const out = new Float32Array(filled);
  if (filled < PROBE_HISTORY_LEN) {
    for (let i = 0; i < filled; i++) out[i] = buf[i];
  } else {
    for (let i = 0; i < PROBE_HISTORY_LEN; i++) {
      out[i] = buf[(writeIdx + i) % PROBE_HISTORY_LEN];
    }
  }
  return out;
}

export function useFieldProbe(opts: UseFieldProbeOptions): FieldProbe {
  const [position, setPositionState]       = useState<Vec2 | null>(null);
  const [channel, setChannelState]         = useState<ProbeChannel>(DEFAULT_PROBE_CHANNEL);
  const [instant, setInstant]              = useState<ProbeInstant | null>(null);
  const [displaySamples, setDisplaySamples] = useState<Float32Array>(() => new Float32Array(0));

  const positionRef = useRef<Vec2 | null>(null);
  const channelRef  = useRef<ProbeChannel>(DEFAULT_PROBE_CHANNEL);

  const buffersRef       = useRef<ChannelBuffers>(makeBuffers());
  const writeIdxRef      = useRef(0);
  const samplesFilledRef = useRef(0);

  // Change-detection keys — sentinel NaN guarantees the first tick fires a solve.
  const lastSimTime = useRef(NaN);
  const lastEpoch   = useRef(NaN);
  const lastC       = useRef(NaN);
  const lastPosX    = useRef(NaN);
  const lastPosY    = useRef(NaN);

  const resetBuffers = useCallback(() => {
    writeIdxRef.current = 0;
    samplesFilledRef.current = 0;
  }, []);

  const invalidateChangeKeys = useCallback(() => {
    lastSimTime.current = NaN;
    lastEpoch.current   = NaN;
    lastC.current       = NaN;
    lastPosX.current    = NaN;
    lastPosY.current    = NaN;
  }, []);

  const setPosition = useCallback((pos: Vec2) => {
    positionRef.current = pos;
    setPositionState(pos);
    resetBuffers();
    invalidateChangeKeys();
    setDisplaySamples(new Float32Array(0));
  }, [resetBuffers, invalidateChangeKeys]);

  const setChannel = useCallback((ch: ProbeChannel) => {
    channelRef.current = ch;
    setChannelState(ch);
    setDisplaySamples(
      snapshotBuffer(buffersRef.current[ch], writeIdxRef.current, samplesFilledRef.current),
    );
  }, []);

  const clear = useCallback(() => {
    positionRef.current = null;
    setPositionState(null);
    setInstant(null);
    setDisplaySamples(new Float32Array(0));
    resetBuffers();
    invalidateChangeKeys();
  }, [resetBuffers, invalidateChangeKeys]);

  useEffect(() => {
    const { chargeRuntimesRef, simTimeRef, simEpochRef, configRef } = opts;
    let rafId = 0;

    function tick() {
      rafId = requestAnimationFrame(tick);

      const pos = positionRef.current;
      if (pos === null) return;

      const t       = simTimeRef.current!;
      const epoch   = simEpochRef.current!;
      const cValue  = configRef.current!.c;

      const epochChanged    = epoch  !== lastEpoch.current;
      const cChanged        = cValue !== lastC.current;
      const positionChanged = pos.x !== lastPosX.current || pos.y !== lastPosY.current;
      const timeChanged     = t !== lastSimTime.current;

      // Epoch or c change invalidates the prior history — the physics is now
      // a different system, so older samples are no longer comparable.
      if (epochChanged || cChanged) resetBuffers();

      const changed = epochChanged || cChanged || positionChanged || timeChanged;
      if (!changed) return;

      const result = evaluateSuperposedLienardWiechertField({
        observationPos:  pos,
        observationTime: t,
        chargeRuntimes:  chargeRuntimesRef.current!,
        config:          configRef.current!,
      });

      const buffers = buffersRef.current;
      const w = writeIdxRef.current;
      if (result === null) {
        for (const ch of PROBE_CHANNELS) buffers[ch][w] = NaN;
        setInstant(null);
      } else {
        for (const ch of PROBE_CHANNELS) buffers[ch][w] = getProbeChannelValue(result, ch);
        setInstant({
          Ex:      result.eTotal.x,
          Ey:      result.eTotal.y,
          Emag:    Math.hypot(result.eTotal.x, result.eTotal.y),
          Bz:      result.bZ,
          BzVel:   result.bZVel,
          BzAccel: result.bZAccel,
        });
      }
      writeIdxRef.current = (w + 1) % PROBE_HISTORY_LEN;
      if (samplesFilledRef.current < PROBE_HISTORY_LEN) {
        samplesFilledRef.current += 1;
      }

      setDisplaySamples(
        snapshotBuffer(buffers[channelRef.current], writeIdxRef.current, samplesFilledRef.current),
      );

      lastSimTime.current = t;
      lastEpoch.current   = epoch;
      lastC.current       = cValue;
      lastPosX.current    = pos.x;
      lastPosY.current    = pos.y;
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // Refs are stable; resetBuffers is stable. Re-running this effect would
    // tear down the loop unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { position, channel, instant, displaySamples, setPosition, setChannel, clear };
}

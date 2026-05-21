import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnimationPlaybackState } from "./types";
import type { PlanetaryTimelineState } from "../types/planetary";

// Timeline window: 24h of replay plus a 48h forecast horizon, stepping every 5 minutes.
export const FRAME_INTERVAL_MS = 5 * 60 * 1000;
export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FORECAST_WINDOW_MS = 48 * 60 * 60 * 1000;
export const LIVE_REFRESH_MS = 15 * 1000;
export const LIVE_FRAME = REPLAY_WINDOW_MS / FRAME_INTERVAL_MS;
export const FORECAST_FRAME = (REPLAY_WINDOW_MS + FORECAST_WINDOW_MS) / FRAME_INTERVAL_MS;
const FRAME_COUNT = FORECAST_FRAME + 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, value));
}

function computeSubFrameProgress(playhead: number): number {
  if (playhead <= 0) return 0;
  const fractional = playhead - Math.floor(playhead);
  return fractional;
}

export function timelineModeFor(input: {
  isTrackingLive: boolean;
  forecastEnabled: boolean;
  selectedTimeMs: number;
  liveTimeMs: number;
}): PlanetaryTimelineState["mode"] {
  if (input.isTrackingLive) return "live";
  if (input.forecastEnabled && input.selectedTimeMs > input.liveTimeMs + FRAME_INTERVAL_MS / 2) {
    return "forecast";
  }
  return "replay";
}

export function maxPlayableFrame(forecastEnabled: boolean): number {
  return forecastEnabled ? FORECAST_FRAME : LIVE_FRAME;
}

export function clampTimelineFrame(frame: number, forecastEnabled: boolean): number {
  if (!Number.isFinite(frame)) return LIVE_FRAME;
  return Math.max(0, Math.min(maxPlayableFrame(forecastEnabled), frame));
}

export function useAnimationTimeline(opts?: {
  /** Called synchronously from the rAF tick with the latest continuous
   *  timeline position, before React state updates. Use this to drive GPU
   *  rendering without the 1-2 frame React render latency inherent in
   *  useEffect-based approaches. */
  onProgress?: (progress: number, timelineMs: number) => void;
}) {
  const onProgressRef = useRef(opts?.onProgress);
  onProgressRef.current = opts?.onProgress;

  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplierState] = useState(2);
  const [forecastEnabled, setForecastEnabledState] = useState(false);
  const [isTrackingLive, setIsTrackingLive] = useState(true);
  const [playheadFrame, setPlayheadFrame] = useState(LIVE_FRAME);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(LIVE_FRAME);
  const [windowStartMs, setWindowStartMs] = useState(() => Date.now() - REPLAY_WINDOW_MS);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number>(performance.now());

  // Mirrors React state so the rAF tick can compute the next position without
  // waiting for setState → rerender. Kept in sync via the tick itself and via
  // a useEffect for external mutations (setFrame, stepFrame, reset, etc.).
  const playheadFrameRef = useRef(LIVE_FRAME);
  const forecastEnabledRef = useRef(forecastEnabled);
  forecastEnabledRef.current = forecastEnabled;

  // Sync ref when React state changes from outside the rAF tick.
  useEffect(() => {
    playheadFrameRef.current = playheadFrame;
  }, [playheadFrame]);

  useEffect(() => {
    if (!isTrackingLive) return;
    const syncLive = () => {
      const now = Date.now();
      const nextStart = now - REPLAY_WINDOW_MS;
      setWindowStartMs(nextStart);
      playheadFrameRef.current = LIVE_FRAME;
      setPlayheadFrame(LIVE_FRAME);
    };
    syncLive();
    const id = window.setInterval(syncLive, LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isTrackingLive]);

  const frame = playheadFrame <= 0 ? 0 : Math.ceil(playheadFrame);
  const subFrameProgress = useMemo(() => computeSubFrameProgress(playheadFrame), [playheadFrame]);

  const setFrame = useCallback((value: number | ((current: number) => number), opts?: { preserveLiveTracking?: boolean }) => {
    setPlayheadFrame((current) => {
      const raw = typeof value === "function" ? value(current) : value;
      const clamped = clampTimelineFrame(raw, forecastEnabledRef.current);
      playheadFrameRef.current = clamped;
      if (!opts?.preserveLiveTracking) {
        setIsTrackingLive(clamped >= LIVE_FRAME - 0.001 && clamped <= LIVE_FRAME + 0.001);
      }
      return clamped;
    });
    lastFrameAtRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    lastFrameAtRef.current = performance.now();
    const tick = (timestamp: number) => {
      const intervalMs = 1000 / Math.max(MIN_SPEED, speedMultiplier);
      const elapsed = timestamp - lastFrameAtRef.current;
      const deltaFrames = elapsed / intervalMs;
      lastFrameAtRef.current = timestamp;

      // Compute next position directly (same logic as the React updater).
      // This lets us call onProgress synchronously, bypassing React's
      // render cycle for the GPU-critical timeProgress write.
      const current = playheadFrameRef.current;
      const legalLoopEnd = Math.min(loopEnd, maxPlayableFrame(forecastEnabledRef.current));
      const span = Math.max(1, legalLoopEnd - loopStart);
      const rawNext = current + deltaFrames;
      const next = rawNext > legalLoopEnd
        ? loopStart + ((rawNext - legalLoopEnd) % span)
        : Math.max(loopStart, Math.min(legalLoopEnd, rawNext));
      playheadFrameRef.current = next;
      setIsTrackingLive(false);

      onProgressRef.current?.(
        computeSubFrameProgress(next),
        windowStartMs + next * FRAME_INTERVAL_MS,
      );

      setPlayheadFrame(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, loopEnd, loopStart, speedMultiplier, windowStartMs]);

  const setSpeedMultiplier = useCallback((value: number) => {
    setSpeedMultiplierState(clampSpeed(value));
  }, []);

  const setForecastEnabled = useCallback((enabled: boolean) => {
    setForecastEnabledState(enabled);
    if (!enabled) {
      setLoopEnd((current) => Math.min(current, LIVE_FRAME));
      setPlayheadFrame((current) => {
        const clamped = clampTimelineFrame(current, false);
        playheadFrameRef.current = clamped;
        if (clamped >= LIVE_FRAME - 0.001) setIsTrackingLive(true);
        return clamped;
      });
    }
  }, []);

  const returnLive = useCallback(() => {
    const now = Date.now();
    setWindowStartMs(now - REPLAY_WINDOW_MS);
    setIsPlaying(false);
    setIsTrackingLive(true);
    playheadFrameRef.current = LIVE_FRAME;
    setPlayheadFrame(LIVE_FRAME);
  }, []);

  const selectedValidTime = useMemo(() => {
    return new Date(windowStartMs + frame * FRAME_INTERVAL_MS).toISOString();
  }, [frame, windowStartMs]);
  const selectedContinuousTime = useMemo(() => {
    return new Date(windowStartMs + playheadFrame * FRAME_INTERVAL_MS).toISOString();
  }, [playheadFrame, windowStartMs]);
  const liveTimeMs = windowStartMs + LIVE_FRAME * FRAME_INTERVAL_MS;
  const selectedTimeMs = windowStartMs + playheadFrame * FRAME_INTERVAL_MS;
  const timelineState: PlanetaryTimelineState = {
    mode: timelineModeFor({
      isTrackingLive,
      forecastEnabled,
      selectedTimeMs,
      liveTimeMs,
    }),
    isTrackingLive,
    forecastEnabled,
    selectedTimeMs,
    liveTimeMs,
    replayStartMs: windowStartMs,
    replayEndMs: liveTimeMs,
    forecastEndMs: windowStartMs + FORECAST_FRAME * FRAME_INTERVAL_MS,
  };

  const playbackState: AnimationPlaybackState = {
    isPlaying,
    speedMultiplier,
    playheadFrame,
    frame,
    frameCount: FRAME_COUNT,
    selectedValidTime,
    selectedContinuousTime,
    loopStart,
    loopEnd,
    subFrameProgress,
    timelineState,
    liveFrame: LIVE_FRAME,
    forecastFrame: FORECAST_FRAME,
  };

  const setLoopWindow = useCallback((startFrame: number, endFrame: number) => {
    const maxFrame = maxPlayableFrame(forecastEnabledRef.current);
    const safeStart = Math.max(0, Math.min(maxFrame - 1, startFrame));
    const safeEnd = Math.max(safeStart + 1, Math.min(maxFrame, endFrame));
    setLoopStart(safeStart);
    setLoopEnd(safeEnd);
    setFrame((current) => Math.max(safeStart, Math.min(safeEnd, current)));
  }, [setFrame]);

  const stepFrame = useCallback((delta: number) => {
    setFrame((current) => Math.max(0, Math.min(FRAME_COUNT - 1, current + delta)));
  }, [setFrame]);

  return {
    playbackState,
    setFrame,
    setSpeedMultiplier,
    setLoopWindow,
    stepFrame,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    toggle: () => setIsPlaying((current) => !current),
    reset: () => {
      returnLive();
    },
    returnLive,
    setForecastEnabled,
    shiftWindowDays: (days: number) => {
      setWindowStartMs((current) => current + days * DAY_MS);
      setIsPlaying(false);
      setIsTrackingLive(false);
    },
  };
}

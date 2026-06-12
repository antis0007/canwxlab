import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnimationPlaybackState } from "./types";
import type { PlanetaryTimelineState } from "../types/planetary";
import type { TimelineViewDays } from "../time/timelineWindow";
import {
  clampTimelineFrame,
  coerceTimelineViewDays,
  DAY_MS,
  DEFAULT_TIMELINE_VIEW_DAYS,
  FRAME_INTERVAL_MS,
  maxPlayableFrame,
  timelineDurationMsForDays,
  timelineFrameCountForDays,
} from "../time/timelineWindow";

export {
  clampTimelineFrame,
  coerceTimelineViewDays,
  DEFAULT_TIMELINE_VIEW_DAYS,
  FORECAST_FRAME,
  FORECAST_WINDOW_MS,
  FRAME_INTERVAL_MS,
  LIVE_FRAME,
  maxPlayableFrame,
  REPLAY_WINDOW_MS,
  timelineDurationMsForDays,
  timelineFrameCountForDays,
  TIMELINE_VIEW_DAY_OPTIONS,
} from "../time/timelineWindow";

import { clampPlayheadToBuffered, type BufferedRange } from "./renderers/satellite/frameGrid";

export type { BufferedRange } from "./renderers/satellite/frameGrid";

export const LIVE_REFRESH_MS = 15 * 1000;
/** Jitter buffer for playback at the live edge: present one satellite frame
 * interval behind the newest buffered frame so the GPU morph always has a
 * complete pair to flow through. Without it the phase pins at 1.0 and the
 * image steps discretely whenever a new frame lands. */
export const SATELLITE_PRESENTATION_LAG_MS = 10 * 60 * 1000;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
export const PLAYBACK_UI_COMMIT_INTERVAL_MS = 100;
const TIMELINE_VIEW_DAYS_STORAGE_KEY = "canwxlab.timelineViewDays.v1";

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, value));
}

function computeSubFrameProgress(playhead: number): number {
  if (playhead <= 0) return 0;
  const fractional = playhead - Math.floor(playhead);
  return fractional;
}

export function shouldCommitPlaybackStateForTesting(input: {
  timestampMs: number;
  lastCommitMs: number;
  nextFrame: number;
  lastCommittedFrame: number;
  minIntervalMs?: number;
}): boolean {
  const minInterval = Math.max(16, input.minIntervalMs ?? PLAYBACK_UI_COMMIT_INTERVAL_MS);
  if (!Number.isFinite(input.timestampMs) || !Number.isFinite(input.lastCommitMs)) return true;
  if (input.timestampMs - input.lastCommitMs >= minInterval) return true;

  // Commit immediately when the integral frame changes. WMS URL templates,
  // timeline labels, availability bars, and layer status should update on
  // discrete model/observation frame boundaries even while sub-frame GPU
  // interpolation continues at the display refresh rate.
  return Math.ceil(input.nextFrame) !== Math.ceil(input.lastCommittedFrame);
}

/** Advance the playhead by deltaFrames within loop limits, then clamp the
 * result to buffered satellite data (video-player model). Exported for tests;
 * the rAF tick uses this directly. */
export function advancePlayheadForTesting(input: {
  current: number;
  deltaFrames: number;
  loopStart: number;
  loopEnd: number;
  maxPlayableFrame: number;
  windowStartMs: number;
  frameIntervalMs: number;
  bufferedRanges: BufferedRange[];
  /** Playback speed; used to derive the real-time rate at the buffer edge. */
  speedMultiplier?: number;
}): { next: number; isBuffering: boolean } {
  const legalLoopEnd = Math.min(input.loopEnd, input.maxPlayableFrame);
  const legalLoopStart = Math.max(0, Math.min(input.loopStart, legalLoopEnd));
  const span = Math.max(1, legalLoopEnd - legalLoopStart);
  const rawNext = input.current + input.deltaFrames;
  const next = rawNext > legalLoopEnd
    ? legalLoopStart + ((rawNext - legalLoopEnd) % span)
    : Math.max(legalLoopStart, Math.min(legalLoopEnd, rawNext));

  if (input.bufferedRanges.length === 0) return { next, isBuffering: false };

  const nextMs = input.windowStartMs + next * input.frameIntervalMs;
  const heldMs = clampPlayheadToBuffered(nextMs, input.bufferedRanges, SATELLITE_PRESENTATION_LAG_MS);
  if (heldMs === nextMs) return { next, isBuffering: false };

  // Held at the buffer edge. Snapping to the edge pins the morph phase and
  // produces discrete steps whenever a new frame lands. Instead, crawl
  // forward at REAL-TIME rate through the presentation-lag cushion: frames
  // arrive at real-time rate too, so the crawl never starves and the clouds
  // flow continuously at 1:1 speed until the buffer outruns the playhead.
  const speed = Math.max(0.25, input.speedMultiplier ?? 1);
  const realtimeDeltaFrames = input.deltaFrames / speed;
  const trueEdgeMs = clampPlayheadToBuffered(nextMs, input.bufferedRanges, 0);
  const trueEdgeFrame = (trueEdgeMs - input.windowStartMs) / input.frameIntervalMs;
  const heldFrame = (heldMs - input.windowStartMs) / input.frameIntervalMs;

  // Crawl from inside the cushion. Entering hold from at/above the true edge
  // (typical: pressing play while tracking live) re-bases INTO the cushion —
  // a one-time step back of one satellite interval that buys continuous flow
  // from then on. A playhead already mid-cushion keeps its position.
  const insideCushion = input.current >= heldFrame - 1 && input.current < trueEdgeFrame - 1e-6;
  const base = insideCushion ? input.current : heldFrame;
  const crawled = Math.min(trueEdgeFrame, base + Math.max(0, realtimeDeltaFrames));

  return {
    next: crawled,
    isBuffering: input.deltaFrames > 0,
  };
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

function readTimelineViewDays(): TimelineViewDays {
  if (typeof window === "undefined") return DEFAULT_TIMELINE_VIEW_DAYS;
  return coerceTimelineViewDays(Number(window.localStorage.getItem(TIMELINE_VIEW_DAYS_STORAGE_KEY)));
}

function writeTimelineViewDays(days: TimelineViewDays): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TIMELINE_VIEW_DAYS_STORAGE_KEY, String(days));
  } catch {
    /* ignore */
  }
}

export function useAnimationTimeline(opts?: {
  /** Called synchronously from the rAF tick with the latest continuous
   *  timeline position, before React state updates. Use this to drive GPU
   *  rendering without the 1-2 frame React render latency inherent in
   *  useEffect-based approaches. */
  onProgress?: (progress: number, timelineMs: number) => void;
  /** Returns currently buffered satellite time ranges. When non-empty, the
   *  playhead is clamped to buffered data (video-player model). */
  getBufferedRanges?: () => BufferedRange[];
}) {
  const onProgressRef = useRef(opts?.onProgress);
  onProgressRef.current = opts?.onProgress;
  const getBufferedRangesRef = useRef(opts?.getBufferedRanges);
  getBufferedRangesRef.current = opts?.getBufferedRanges;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const isBufferingRef = useRef(false);
  const [speedMultiplier, setSpeedMultiplierState] = useState(2);
  const [forecastEnabled, setForecastEnabledState] = useState(false);
  const [isTrackingLive, setIsTrackingLive] = useState(true);
  const [visibleDays, setVisibleDaysState] = useState<TimelineViewDays>(readTimelineViewDays);
  const [liveTimeMs, setLiveTimeMs] = useState(() => Date.now());
  const [playheadFrame, setPlayheadFrame] = useState(() => timelineFrameCountForDays(readTimelineViewDays()) - 1);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(() => timelineFrameCountForDays(readTimelineViewDays()) - 1);
  const [windowStartMs, setWindowStartMs] = useState(() => Date.now() - timelineDurationMsForDays(readTimelineViewDays()));
  const frameCount = useMemo(() => timelineFrameCountForDays(visibleDays), [visibleDays]);
  const displayEndFrame = frameCount - 1;
  const windowEndMs = windowStartMs + displayEndFrame * FRAME_INTERVAL_MS;
  const liveFrame = (liveTimeMs - windowStartMs) / FRAME_INTERVAL_MS;
  const maxPlayableFrameValue = maxPlayableFrame(forecastEnabled, liveFrame, displayEndFrame);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number>(performance.now());
  const lastStateCommitAtRef = useRef<number>(performance.now());
  const lastCommittedFrameRef = useRef<number>(displayEndFrame);
  const previousMaxPlayableFrameRef = useRef<number>(displayEndFrame);

  // Mirrors React state so the rAF tick can compute the next position without
  // waiting for setState → rerender. Kept in sync via the tick itself and via
  // a useEffect for external mutations (setFrame, stepFrame, reset, etc.).
  const playheadFrameRef = useRef(displayEndFrame);
  const displayEndFrameRef = useRef(displayEndFrame);
  const liveFrameRef = useRef(liveFrame);
  const maxPlayableFrameRef = useRef(maxPlayableFrameValue);
  const forecastEnabledRef = useRef(forecastEnabled);
  const isTrackingLiveRef = useRef(isTrackingLive);
  displayEndFrameRef.current = displayEndFrame;
  liveFrameRef.current = liveFrame;
  maxPlayableFrameRef.current = maxPlayableFrameValue;
  forecastEnabledRef.current = forecastEnabled;
  isTrackingLiveRef.current = isTrackingLive;

  // Sync ref when React state changes from outside the rAF tick.
  useEffect(() => {
    playheadFrameRef.current = playheadFrame;
    lastCommittedFrameRef.current = playheadFrame;
  }, [playheadFrame]);

  useEffect(() => {
    writeTimelineViewDays(visibleDays);
  }, [visibleDays]);

  useEffect(() => {
    const id = window.setInterval(() => setLiveTimeMs(Date.now()), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isTrackingLive) return;
    const nextStart = liveTimeMs - displayEndFrame * FRAME_INTERVAL_MS;
    setWindowStartMs(nextStart);
    isTrackingLiveRef.current = true;
    playheadFrameRef.current = displayEndFrame;
    lastCommittedFrameRef.current = displayEndFrame;
    lastStateCommitAtRef.current = performance.now();
    setLoopStart(0);
    setLoopEnd(displayEndFrame);
    setPlayheadFrame(displayEndFrame);
  }, [displayEndFrame, isTrackingLive, liveTimeMs]);

  useEffect(() => {
    const previousMax = previousMaxPlayableFrameRef.current;
    previousMaxPlayableFrameRef.current = maxPlayableFrameValue;

    setLoopStart((current) => Math.max(0, Math.min(current, Math.max(0, maxPlayableFrameValue - 1))));
    setLoopEnd((current) => {
      if (current > maxPlayableFrameValue || Math.abs(current - previousMax) < 0.001) {
        return maxPlayableFrameValue;
      }
      return Math.max(0, Math.min(maxPlayableFrameValue, current));
    });
    setPlayheadFrame((current) => {
      const clamped = clampTimelineFrame(current, forecastEnabled, liveFrame, displayEndFrame);
      playheadFrameRef.current = clamped;
      lastCommittedFrameRef.current = clamped;
      lastStateCommitAtRef.current = performance.now();
      return clamped;
    });
  }, [displayEndFrame, forecastEnabled, liveFrame, maxPlayableFrameValue]);

  const frame = playheadFrame <= 0 ? 0 : Math.min(displayEndFrame, Math.ceil(playheadFrame));
  const subFrameProgress = useMemo(() => computeSubFrameProgress(playheadFrame), [playheadFrame]);

  const setFrame = useCallback((value: number | ((current: number) => number), opts?: { preserveLiveTracking?: boolean }) => {
    setPlayheadFrame((current) => {
      const raw = typeof value === "function" ? value(current) : value;
      const clamped = clampTimelineFrame(
        raw,
        forecastEnabledRef.current,
        liveFrameRef.current,
        displayEndFrameRef.current,
      );
      playheadFrameRef.current = clamped;
      lastCommittedFrameRef.current = clamped;
      lastStateCommitAtRef.current = performance.now();
      if (!opts?.preserveLiveTracking) {
        const live = liveFrameRef.current;
        const tracking = (
          live >= 0 &&
          live <= displayEndFrameRef.current &&
          Math.abs(clamped - live) <= 0.001
        );
        isTrackingLiveRef.current = tracking;
        setIsTrackingLive(tracking);
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
      const { next, isBuffering: buffering } = advancePlayheadForTesting({
        current,
        deltaFrames,
        loopStart,
        loopEnd,
        maxPlayableFrame: maxPlayableFrameRef.current,
        windowStartMs,
        frameIntervalMs: FRAME_INTERVAL_MS,
        bufferedRanges: getBufferedRangesRef.current?.() ?? [],
        speedMultiplier,
      });
      playheadFrameRef.current = next;
      if (buffering !== isBufferingRef.current) {
        isBufferingRef.current = buffering;
        setIsBuffering(buffering);
      }
      if (isTrackingLiveRef.current) {
        isTrackingLiveRef.current = false;
        setIsTrackingLive(false);
      }

      onProgressRef.current?.(
        computeSubFrameProgress(next),
        windowStartMs + next * FRAME_INTERVAL_MS,
      );

      if (shouldCommitPlaybackStateForTesting({
        timestampMs: timestamp,
        lastCommitMs: lastStateCommitAtRef.current,
        nextFrame: next,
        lastCommittedFrame: lastCommittedFrameRef.current,
      })) {
        lastStateCommitAtRef.current = timestamp;
        lastCommittedFrameRef.current = next;
        setPlayheadFrame(next);
      }
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
      setLoopEnd((current) => Math.min(current, maxPlayableFrameRef.current));
      setPlayheadFrame((current) => {
        const clamped = clampTimelineFrame(current, false, liveFrameRef.current, displayEndFrameRef.current);
        playheadFrameRef.current = clamped;
        lastCommittedFrameRef.current = clamped;
        lastStateCommitAtRef.current = performance.now();
        if (
          liveFrameRef.current >= 0 &&
          liveFrameRef.current <= displayEndFrameRef.current &&
          Math.abs(clamped - liveFrameRef.current) <= 0.001
        ) {
          isTrackingLiveRef.current = true;
          setIsTrackingLive(true);
        }
        return clamped;
      });
    }
  }, []);

  const returnLive = useCallback(() => {
    const now = Date.now();
    const nextEndFrame = displayEndFrameRef.current;
    setLiveTimeMs(now);
    setWindowStartMs(now - nextEndFrame * FRAME_INTERVAL_MS);
    setIsPlaying(false);
    isTrackingLiveRef.current = true;
    setIsTrackingLive(true);
    playheadFrameRef.current = nextEndFrame;
    lastCommittedFrameRef.current = nextEndFrame;
    lastStateCommitAtRef.current = performance.now();
    setLoopStart(0);
    setLoopEnd(nextEndFrame);
    setPlayheadFrame(nextEndFrame);
  }, []);

  const selectedValidTime = useMemo(() => {
    return new Date(windowStartMs + frame * FRAME_INTERVAL_MS).toISOString();
  }, [frame, windowStartMs]);
  const selectedContinuousTime = useMemo(() => {
    return new Date(windowStartMs + playheadFrame * FRAME_INTERVAL_MS).toISOString();
  }, [playheadFrame, windowStartMs]);
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
    replayEndMs: Math.max(windowStartMs, Math.min(liveTimeMs, windowEndMs)),
    forecastEndMs: windowEndMs,
  };

  const playbackState: AnimationPlaybackState = {
    isPlaying,
    isBuffering,
    speedMultiplier,
    playheadFrame,
    frame,
    frameCount,
    visibleDays,
    selectedValidTime,
    selectedContinuousTime,
    loopStart,
    loopEnd,
    subFrameProgress,
    timelineState,
    liveFrame,
    forecastFrame: displayEndFrame,
  };

  const setLoopWindow = useCallback((startFrame: number, endFrame: number) => {
    const maxFrame = maxPlayableFrameRef.current;
    if (maxFrame <= 0) {
      setLoopStart(0);
      setLoopEnd(0);
      setFrame(0);
      return;
    }
    const safeStart = Math.max(0, Math.min(maxFrame - 1, startFrame));
    const safeEnd = Math.max(safeStart + 1, Math.min(maxFrame, endFrame));
    setLoopStart(safeStart);
    setLoopEnd(safeEnd);
    setFrame((current) => Math.max(safeStart, Math.min(safeEnd, current)));
  }, [setFrame]);

  const stepFrame = useCallback((delta: number) => {
    setFrame((current) => Math.max(0, Math.min(displayEndFrameRef.current, current + delta)));
  }, [setFrame]);

  const setVisibleDays = useCallback((days: TimelineViewDays) => {
    setVisibleDaysState(coerceTimelineViewDays(days));
    setIsPlaying(false);
  }, []);

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
    setVisibleDays,
    shiftWindowDays: (days: number) => {
      setWindowStartMs((current) => current + days * DAY_MS);
      setIsPlaying(false);
      setIsTrackingLive(false);
    },
  };
}

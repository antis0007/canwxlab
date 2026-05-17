import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnimationPlaybackState } from "./types";

// Timeline window: one full UTC day of radar/satellite, stepping every 5 minutes.
const FRAME_COUNT = 24 * 12 + 1;
const FRAME_INTERVAL_MS = 5 * 60 * 1000;
const WINDOW_SPAN_MS = (FRAME_COUNT - 1) * FRAME_INTERVAL_MS;
const DAY_MS = 24 * 60 * 60 * 1000;

export function useAnimationTimeline() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [frame, setFrame] = useState(FRAME_COUNT - 1);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(FRAME_COUNT - 1);
  // Window anchor: refreshed on mount so playback covers the last WINDOW_SPAN_MS.
  const [windowStartMs, setWindowStartMs] = useState(() => Date.now() - WINDOW_SPAN_MS);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number>(performance.now());

  const advanceFrame = useCallback(() => {
    setFrame((current) => {
      const next = current + 1;
      if (next > loopEnd) return loopStart;
      return next;
    });
  }, [loopEnd, loopStart]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = (timestamp: number) => {
      const intervalMs = 1000 / Math.max(0.25, speedMultiplier);
      if (timestamp - lastFrameAtRef.current >= intervalMs) {
        advanceFrame();
        lastFrameAtRef.current = timestamp;
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
  }, [advanceFrame, isPlaying, speedMultiplier]);

  const selectedValidTime = useMemo(() => {
    return new Date(windowStartMs + frame * FRAME_INTERVAL_MS).toISOString();
  }, [frame, windowStartMs]);

  const playbackState: AnimationPlaybackState = {
    isPlaying,
    speedMultiplier,
    frame,
    frameCount: FRAME_COUNT,
    selectedValidTime,
    loopStart,
    loopEnd,
  };

  const setLoopWindow = useCallback((startFrame: number, endFrame: number) => {
    const safeStart = Math.max(0, Math.min(FRAME_COUNT - 2, startFrame));
    const safeEnd = Math.max(safeStart + 1, Math.min(FRAME_COUNT - 1, endFrame));
    setLoopStart(safeStart);
    setLoopEnd(safeEnd);
    setFrame((current) => Math.max(safeStart, Math.min(safeEnd, current)));
  }, []);

  const stepFrame = useCallback((delta: number) => {
    setFrame((current) => Math.max(0, Math.min(FRAME_COUNT - 1, current + delta)));
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
      setFrame(FRAME_COUNT - 1);
      setIsPlaying(false);
    },
    shiftWindowDays: (days: number) => {
      setWindowStartMs((current) => current + days * DAY_MS);
      setIsPlaying(false);
    },
  };
}

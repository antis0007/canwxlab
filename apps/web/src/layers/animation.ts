import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnimationPlaybackState } from "./types";

const FRAME_COUNT = 240;

export function useAnimationTimeline() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [frame, setFrame] = useState(0);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(FRAME_COUNT - 1);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number>(performance.now());

  const advanceFrame = useCallback(() => {
    setFrame((current) => {
      const next = current + 1;
      if (next > loopEnd) {
        return loopStart;
      }
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
      const intervalMs = 1000 / Math.max(0.25, speedMultiplier * 2);
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
    const start = new Date();
    start.setUTCMinutes(start.getUTCMinutes() + frame * 5);
    return start.toISOString();
  }, [frame]);

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

  return {
    playbackState,
    setFrame,
    setSpeedMultiplier,
    setLoopWindow,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    toggle: () => setIsPlaying((current) => !current),
    reset: () => {
      setFrame(0);
      setIsPlaying(false);
    },
  };
}

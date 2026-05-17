// Persistent draggable width for the left/right workbench sidebars.
//
// Returns the current width plus pointer handlers for a thin <div>
// edge. Width is clamped to [min, max] and saved per `storageKey` so
// the operator's layout persists across sessions.

import { useCallback, useEffect, useRef, useState } from "react";

interface ResizeHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}

export interface UseResizableWidthOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Whether to grow leftwards (right sidebar) or rightwards (left). */
  edge: "left" | "right";
}

function readStored(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`canwxlab.layout.${key}`);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch { /* ignore */ }
  return fallback;
}

function persist(key: string, width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`canwxlab.layout.${key}`, String(width));
  } catch { /* ignore */ }
}

export function useResizableWidth(options: UseResizableWidthOptions): {
  width: number;
  handlers: ResizeHandlers;
} {
  const [width, setWidth] = useState<number>(() => {
    const raw = readStored(options.storageKey, options.defaultWidth);
    return Math.max(options.minWidth, Math.min(options.maxWidth, raw));
  });

  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Persist on width changes (debounced via microtask).
  useEffect(() => {
    persist(options.storageKey, width);
  }, [options.storageKey, width]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragStateRef.current = { startX: event.clientX, startWidth: width };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [width]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    const signed = options.edge === "right" ? delta : -delta;
    const next = Math.max(
      options.minWidth,
      Math.min(options.maxWidth, drag.startWidth + signed),
    );
    setWidth(next);
  }, [options.edge, options.minWidth, options.maxWidth]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  }, []);

  const onDoubleClick = useCallback(() => {
    setWidth(options.defaultWidth);
  }, [options.defaultWidth]);

  return { width, handlers: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick } };
}

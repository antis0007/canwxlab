// Reusable draggable floating panel for sub-popups (star card, city
// picker, future inspectors). The header is the drag handle; the panel
// stays inside the visible viewport; position can be persisted to
// localStorage if a `storageKey` is supplied.
//
// Deliberately framework-light: no portal, no animation; the panel is
// rendered in the parent's React tree so it inherits the surrounding
// stacking context. Drag uses pointer-events so it works for mouse,
// pen, and touch.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface DraggablePanelProps {
  /** Visible label on the drag header. */
  title: ReactNode;
  /** Optional subtitle line shown below the title. */
  subtitle?: ReactNode;
  /** Called when the user clicks the close button. */
  onClose?: () => void;
  /** Persist position to localStorage[`canwxlab.panel.${storageKey}`]. */
  storageKey?: string;
  /** Initial top/left in CSS pixels; clamped to the viewport. */
  defaultPosition?: { x: number; y: number };
  /** Fixed panel width in pixels (panel does not change size). */
  width?: number;
  /** Optional extra classes for outer container. */
  className?: string;
  /** Optional extra inline style. */
  style?: CSSProperties;
  children: ReactNode;
  /** ARIA label for the dialog. */
  ariaLabel?: string;
}

interface Position { x: number; y: number; }

function readStoredPosition(key?: string): Position | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`canwxlab.panel.${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function persistPosition(key: string | undefined, pos: Position): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`canwxlab.panel.${key}`, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function clampToViewport(pos: Position, width: number, height: number): Position {
  if (typeof window === "undefined") return pos;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(4, Math.min(pos.x, vw - width - 4)),
    y: Math.max(4, Math.min(pos.y, vh - height - 4)),
  };
}

export function DraggablePanel({
  title,
  subtitle,
  onClose,
  storageKey,
  defaultPosition,
  width = 300,
  className,
  style,
  children,
  ariaLabel,
}: DraggablePanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<Position | null>(null);
  const [position, setPosition] = useState<Position>(() => {
    const stored = readStoredPosition(storageKey);
    if (stored) return stored;
    if (defaultPosition) return defaultPosition;
    return { x: 24, y: 60 };
  });

  // After mount, re-clamp in case the saved position was off-screen (e.g. the
  // user resized the window between sessions or moved to a smaller monitor).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const height = el.getBoundingClientRect().height || 240;
    setPosition((current) => clampToViewport(current, width, height));
  }, [width]);

  const onHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    dragOffsetRef.current = { x: event.clientX - position.x, y: event.clientY - position.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [position.x, position.y]);

  const onHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const offset = dragOffsetRef.current;
    if (!offset) return;
    const el = containerRef.current;
    const height = el?.getBoundingClientRect().height ?? 240;
    const next = clampToViewport(
      { x: event.clientX - offset.x, y: event.clientY - offset.y },
      width,
      height,
    );
    setPosition(next);
  }, [width]);

  const onHeaderPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffsetRef.current) return;
    dragOffsetRef.current = null;
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    persistPosition(storageKey, position);
  }, [storageKey, position]);

  return (
    <div
      ref={containerRef}
      className={`wb-draggable-panel${className ? ` ${className}` : ""}`}
      style={{ left: position.x, top: position.y, width, ...style }}
      role="dialog"
      aria-label={typeof ariaLabel === "string" ? ariaLabel : undefined}
    >
      <div
        className="wb-draggable-panel-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div className="wb-draggable-panel-title-block">
          <div className="wb-draggable-panel-title">{title}</div>
          {subtitle && <div className="wb-draggable-panel-subtitle">{subtitle}</div>}
        </div>
        {onClose && (
          <button
            type="button"
            className="wb-draggable-panel-close"
            data-no-drag=""
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label="Close panel"
          >×</button>
        )}
      </div>
      <div className="wb-draggable-panel-body">{children}</div>
    </div>
  );
}

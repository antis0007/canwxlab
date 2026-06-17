import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { WindowManager } from "../hooks/useWindowManager";

export interface WindowShellProps {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  zIndex: number;
  initialPosition: { x: number; y: number };
  initialSize: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  onMinimize: () => void;
  onFocus: () => void;
  onMove: (pos: { x: number; y: number }) => void;
  onResize: (size: { width: number; height: number }) => void;
  children: ReactNode;
  wm: WindowManager;
}

type Pos = { x: number; y: number };
type Size = { width: number; height: number };

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function clampPos(pos: Pos, size: Size): Pos {
  if (typeof window === "undefined") return pos;
  return {
    x: clamp(pos.x, 0, window.innerWidth - size.width - 4),
    y: clamp(pos.y, 0, window.innerHeight - 60),
  };
}

export function WindowShell({
  id, title, subtitle, icon, zIndex,
  initialPosition, initialSize,
  minWidth = 240, minHeight = 160,
  onClose, onMinimize, onFocus, onMove, onResize,
  children,
}: WindowShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<Pos | null>(null);
  const resizeOrigin = useRef<{ mouseX: number; mouseY: number; w: number; h: number } | null>(null);
  const [pos, setPos] = useState<Pos>(() => clampPos(initialPosition, initialSize));
  const [size, setSize] = useState<Size>(initialSize);

  // Drag — header
  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    onFocus();
  }, [pos.x, pos.y, onFocus]);

  const onHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    const off = dragOffset.current;
    if (!off) return;
    const next = clampPos({ x: e.clientX - off.x, y: e.clientY - off.y }, size);
    setPos(next);
  }, [size]);

  const onHeaderPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /**/ }
    onMove(pos);
  }, [pos, onMove]);

  // Resize — bottom-right handle
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    resizeOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, w: size.width, h: size.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [size]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const o = resizeOrigin.current;
    if (!o) return;
    const newW = clamp(o.w + (e.clientX - o.mouseX), minWidth, 640);
    const newH = clamp(o.h + (e.clientY - o.mouseY), minHeight, 820);
    setSize({ width: newW, height: newH });
  }, [minWidth, minHeight]);

  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!resizeOrigin.current) return;
    resizeOrigin.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /**/ }
    onResize(size);
  }, [size, onResize]);

  // Re-clamp after mount (saved position may be off-screen)
  useEffect(() => {
    setPos((p) => clampPos(p, size));
  }, [size]);

  const style: CSSProperties = {
    position: "fixed",
    left: pos.x,
    top: pos.y,
    width: size.width,
    height: size.height,
    zIndex,
  };

  return (
    <div
      ref={shellRef}
      className="wb-shell"
      style={style}
      role="dialog"
      aria-label={typeof title === "string" ? title : id}
    >
      {/* Header */}
      <div
        className="wb-shell-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div className="wb-shell-title-block">
          {icon && <span className="wb-shell-icon">{icon}</span>}
          <div className="wb-shell-title">{title}</div>
          {subtitle && <div className="wb-shell-subtitle">{subtitle}</div>}
        </div>
        <div className="wb-shell-controls" data-no-drag="">
          <button type="button" className="wb-shell-btn" onClick={onMinimize} title="Minimize" aria-label="Minimize panel">−</button>
          <button type="button" className="wb-shell-btn wb-shell-close" onClick={onClose} title="Close" aria-label="Close panel">×</button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="wb-shell-body">{children}</div>

      {/* Resize handle */}
      <div
        className="wb-shell-resize-handle"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        aria-hidden="true"
      />
    </div>
  );
}

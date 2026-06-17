import { useCallback, useMemo, useReducer, useRef } from "react";
import { entityWindowId } from "../types/entities";
import type { SelectedEntity, EntityKind } from "../types/entities";

export interface ManagedWindow {
  id: string;
  kind: EntityKind;
  entity: SelectedEntity;
  minimized: boolean;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface WindowManager {
  windows: readonly ManagedWindow[];
  open:         (entity: SelectedEntity) => void;
  close:        (id: string) => void;
  minimize:     (id: string) => void;
  restore:      (id: string) => void;
  bringToFront: (id: string) => void;
  move:         (id: string, pos: { x: number; y: number }) => void;
  resize:       (id: string, size: { width: number; height: number }) => void;
}

type Action =
  | { type: "open";         entity: SelectedEntity; zIndex: number }
  | { type: "close";        id: string }
  | { type: "minimize";     id: string }
  | { type: "restore";      id: string }
  | { type: "bringToFront"; id: string; zIndex: number }
  | { type: "move";         id: string; pos: { x: number; y: number } }
  | { type: "resize";       id: string; size: { width: number; height: number } };

const DEFAULT_SIZE = { width: 300, height: 380 };
const PANEL_OFFSET = 40;

function defaultPosition(index: number): { x: number; y: number } {
  const base = typeof window !== "undefined"
    ? { x: window.innerWidth - DEFAULT_SIZE.width - 24, y: 60 }
    : { x: 600, y: 60 };
  return { x: base.x - index * PANEL_OFFSET, y: base.y + index * PANEL_OFFSET };
}

function reducer(state: ManagedWindow[], action: Action): ManagedWindow[] {
  switch (action.type) {
    case "open": {
      const id = entityWindowId(action.entity);
      const existing = state.find((w) => w.id === id);
      if (existing) {
        return state.map((w) =>
          w.id === id ? { ...w, minimized: false, zIndex: action.zIndex } : w,
        );
      }
      const newWin: ManagedWindow = {
        id,
        kind: action.entity.kind,
        entity: action.entity,
        minimized: false,
        zIndex: action.zIndex,
        position: defaultPosition(state.length % 5),
        size: DEFAULT_SIZE,
      };
      return [...state, newWin];
    }
    case "close":
      return state.filter((w) => w.id !== action.id);
    case "minimize":
      return state.map((w) => w.id === action.id ? { ...w, minimized: true } : w);
    case "restore":
      return state.map((w) => w.id === action.id ? { ...w, minimized: false } : w);
    case "bringToFront":
      return state.map((w) =>
        w.id === action.id ? { ...w, zIndex: action.zIndex } : w,
      );
    case "move":
      return state.map((w) => w.id === action.id ? { ...w, position: action.pos } : w);
    case "resize":
      return state.map((w) => w.id === action.id ? { ...w, size: action.size } : w);
    default:
      return state;
  }
}

export function useWindowManager(): WindowManager {
  const [windows, dispatch] = useReducer(reducer, []);
  const zRef = useRef(200);

  const open = useCallback((entity: SelectedEntity) => {
    dispatch({ type: "open", entity, zIndex: ++zRef.current });
  }, []);
  const close        = useCallback((id: string) => dispatch({ type: "close", id }), []);
  const minimize     = useCallback((id: string) => dispatch({ type: "minimize", id }), []);
  const restore      = useCallback((id: string) => dispatch({ type: "restore", id }), []);
  const bringToFront = useCallback((id: string) => dispatch({ type: "bringToFront", id, zIndex: ++zRef.current }), []);
  const move         = useCallback((id: string, pos: { x: number; y: number }) => dispatch({ type: "move", id, pos }), []);
  const resize       = useCallback((id: string, size: { width: number; height: number }) => dispatch({ type: "resize", id, size }), []);

  return useMemo<WindowManager>(
    () => ({ windows, open, close, minimize, restore, bringToFront, move, resize }),
    [windows, open, close, minimize, restore, bringToFront, move, resize],
  );
}

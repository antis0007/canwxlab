import { useState, useCallback } from "react";
import type { SelectedEntity } from "../types/entities";

export interface SelectionApi {
  selection: SelectedEntity | null;
  select: (entity: SelectedEntity) => void;
  clear: () => void;
}

export function useSelection(): SelectionApi {
  const [selection, setSelection] = useState<SelectedEntity | null>(null);

  const select = useCallback((entity: SelectedEntity) => {
    setSelection((prev) =>
      prev?.kind === entity.kind && prev.id === entity.id ? null : entity,
    );
  }, []);

  const clear = useCallback(() => setSelection(null), []);

  return { selection, select, clear };
}

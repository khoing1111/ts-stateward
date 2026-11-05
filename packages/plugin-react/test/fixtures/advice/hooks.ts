import { useState } from "react";

export type Hsva = { h: number; s: number; v: number };
export type IndexState = { page: number; filter: string };

function restore(entries: string[], position: number): string | undefined {
  return entries[position];
}

/** Uses nothing from the hook: moves to module scope. */
export function useSkip() {
  const onSkip = () => {
    console.info("skipped");
  };
  return { onSkip };
}

/** The same, written inside the returned object: nothing for a quick fix to move. */
export function useLog() {
  return { onLog: () => console.info("logged") };
}

/** Uses only what its caller passes in: the caller can pass it instead. */
export function useUndo(entries: string[], position: number) {
  const onUndo = () => restore(entries, position);
  return { onUndo };
}

/** Uses its own state: a handler for a memo child. */
export function useRows() {
  const [rows, setRows] = useState<string[]>([]);
  const onSelect = (id: string) => setRows(rows.filter((row) => row !== id));
  return { rows, onSelect };
}

/** A value built only from the hook's state. */
export function useColor() {
  const [hsva, setHsva] = useState<Hsva>({ h: 0, s: 0, v: 0 });
  const swatch = { hue: hsva.h, shade: hsva.v };
  return { swatch, setHsva };
}

/** A plain function of the project: a new object on each call. */
export function resolveIndexState(urlState: string, saved: IndexState): IndexState {
  return { page: urlState.length, filter: saved.filter };
}

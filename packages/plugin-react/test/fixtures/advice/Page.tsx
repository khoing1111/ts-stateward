import { memo, useEffect } from "react";
import { resolveIndexState, useColor, useLog, useRows, useSkip, useUndo } from "./hooks.js";
import type { IndexState } from "./hooks.js";

const RowList = memo(function RowList({
  rows,
  onSelect,
}: {
  rows: string[];
  onSelect: (id: string) => void;
}) {
  return <ul onClick={() => onSelect(rows[0] ?? "")} />;
});

const Swatch = memo(function Swatch({ swatch }: { swatch: { hue: number; shade: number } }) {
  return <i>{swatch.hue + swatch.shade}</i>;
});

const Toolbar = memo(function Toolbar({ handler }: { handler: () => void }) {
  return <b onClick={handler} />;
});

export function SkipPage() {
  const { onSkip } = useSkip();
  useEffect(() => {
    onSkip();
  }, [onSkip]);
  return null;
}

export function LogPage() {
  const { onLog } = useLog();
  useEffect(() => {
    onLog();
  }, [onLog]);
  return null;
}

export function IndexPage({ urlState, saved }: { urlState: string; saved: IndexState }) {
  const index = resolveIndexState(urlState, saved);
  useEffect(() => {
    console.info(index.page);
  }, [index]);
  return null;
}

export function UndoPage({ entries, position }: { entries: string[]; position: number }) {
  const { onUndo } = useUndo(entries, position);
  useEffect(() => {
    onUndo();
  }, [onUndo]);
  return null;
}

export function UndoToolbar({ entries, position }: { entries: string[]; position: number }) {
  const { onUndo } = useUndo(entries, position);
  return <Toolbar handler={onUndo} />;
}

export function RowsPage() {
  const { rows, onSelect } = useRows();
  return <RowList rows={rows} onSelect={onSelect} />;
}

export function ColorPage() {
  const { swatch } = useColor();
  return <Swatch swatch={swatch} />;
}

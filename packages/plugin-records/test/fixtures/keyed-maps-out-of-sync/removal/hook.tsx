import { useState } from "react";

type RowId = string & { readonly brand: "RowId" };

export function useRows() {
  const [labels, setLabels] = useState<Record<RowId, string>>({});
  const [heights, setHeights] = useState<Record<RowId, number>>({});

  const add = (id: RowId, label: string) => {
    setLabels((prev) => ({ ...prev, [id]: label }));
    setHeights((prev) => ({ ...prev, [id]: 0 }));
  };
  const drop = (id: RowId) => {
    setLabels(({ [id]: _gone, ...rest }) => rest);
  };
  const trim = (keep: RowId) => {
    setHeights((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key === keep)));
  };
  const keepOnly = (keep: RowId) => {
    setHeights((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key === keep)));
    setLabels((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key === keep)));
  };
  return { labels, heights, add, drop, trim, keepOnly };
}

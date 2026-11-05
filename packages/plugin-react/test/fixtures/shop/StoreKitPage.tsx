import { useEffect } from "react";
import { create, useSelector } from "store-kit";

type State = { filters: { query: string } };

/** Hooks a package makes at module level: the package's, so stateward says nothing of them. */
const useStore = create<State>()(() => ({ filters: { query: "" } }));
const useAppSelector = useSelector.withTypes<State>();

export function StoreKitPage() {
  const { filters } = useStore();
  const selected = useAppSelector((state) => state.filters);
  useEffect(() => {
    document.title = `${filters.query} ${selected.query}`;
  }, [filters, selected]);
  return null;
}

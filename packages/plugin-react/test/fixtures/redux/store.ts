import { useDispatch, useSelector, useStore } from "react-redux";
import type { Dispatch, Store } from "react-redux";

export type State = { items: string[] };
export type AppDispatch = Dispatch;
export type AppStore = Store<State>;

// The typed hooks react-redux recommends, and the older form.
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppStore = useStore.withTypes<AppStore>();
export const useAppSelector = useSelector.withTypes<State>();
export const useOldDispatch: () => AppDispatch = useDispatch;

/** A wrapper of the project around `useDispatch`. */
export function useActions() {
  return useAppDispatch();
}

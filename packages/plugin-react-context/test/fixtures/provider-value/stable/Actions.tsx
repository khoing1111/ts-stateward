import {
  createContext,
  useCallback,
  useMemo,
  useReducer,
  useState,
  type Context,
  type ReactNode,
} from "react";
import type { Stable } from "./guarantees.js";

type Actions = { add: (item: string) => void; clear: () => void };
type Action = { type: "add"; item: string } | { type: "clear" };

function reducer(items: string[], action: Action): string[] {
  return action.type === "add" ? [...items, action.item] : [];
}

const noop = (): void => {};
const MODULE_ACTIONS: Actions = { add: noop, clear: noop };

export const ActionsContext: Context<Actions> & Stable = createContext<Actions>(MODULE_ACTIONS);
export const DispatchContext: Context<(action: Action) => void> & Stable = createContext<
  (action: Action) => void
>(noop);
/** Not stated: an inline value is a warning, as before. */
export const PlainContext = createContext<Actions>(MODULE_ACTIONS);

type Props = { children: ReactNode };

/** `useMemo` over `dispatch`: never changes. */
export function MemoOverDispatch({ children }: Props) {
  const [, dispatch] = useReducer(reducer, []);
  const actions = useMemo(
    () => ({ add: (item: string) => dispatch({ type: "add", item }), clear: () => dispatch({ type: "clear" }) }),
    [dispatch],
  );
  return <ActionsContext value={actions}>{children}</ActionsContext>;
}

/** `dispatch` itself. */
export function PassDispatch({ children }: Props) {
  const [, dispatch] = useReducer(reducer, []);
  return <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>;
}

/** A module constant. */
export function ModuleConstant({ children }: Props) {
  return <ActionsContext value={MODULE_ACTIONS}>{children}</ActionsContext>;
}

/** `useCallback`s over a setter, then `useMemo` over them. */
export function Callbacks({ children }: Props) {
  const [, setItems] = useState<string[]>([]);
  const add = useCallback((item: string) => setItems((items) => [...items, item]), []);
  const clear = useCallback(() => setItems([]), [setItems]);
  const actions = useMemo(() => ({ add, clear }), [add, clear]);
  return <ActionsContext value={actions}>{children}</ActionsContext>;
}

/** A new object every render. */
export function Inline({ children }: Props) {
  const [, setItems] = useState<string[]>([]);
  return (
    <ActionsContext value={{ add: (item) => setItems([item]), clear: () => setItems([]) }}>
      {children}
    </ActionsContext>
  );
}

/** Rebuilt whenever `items` changes. */
export function DependsOnState({ children }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const actions = useMemo(
    () => ({ add: (item: string) => setItems([...items, item]), clear: () => setItems([]) }),
    [items],
  );
  return <ActionsContext value={actions}>{children}</ActionsContext>;
}

/** Rebuilt whenever the parent passes a new `onAdd`. */
export function DependsOnProp({ children, onAdd }: Props & { onAdd: (item: string) => void }) {
  const actions = useMemo(() => ({ add: onAdd, clear: noop }), [onAdd]);
  return <ActionsContext value={actions}>{children}</ActionsContext>;
}

function useActions(): Actions {
  return MODULE_ACTIONS;
}

/** From a hook of the project: not followed. */
export function FromHook({ children }: Props) {
  return <ActionsContext value={useActions()}>{children}</ActionsContext>;
}

/** Not stated `Stable`: the usual warning. */
export function Plain({ children }: Props) {
  return <PlainContext value={{ add: noop, clear: noop }}>{children}</PlainContext>;
}

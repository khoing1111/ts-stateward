// The parts of react-redux's declarations the fixture uses.
export type Dispatch = (action: { type: string }) => void;
export type Store<S> = { getState(): S; dispatch: Dispatch; subscribe(listener: () => void): () => void };
export interface UseDispatch<D = Dispatch> {
  (): D;
  withTypes<T extends D>(): UseDispatch<T>;
}
export interface UseStore<St = Store<unknown>> {
  (): St;
  withTypes<T extends St>(): UseStore<T>;
}
export interface UseSelector<S = unknown> {
  <T>(select: (state: S) => T): T;
  withTypes<T>(): UseSelector<T>;
}
export declare const useDispatch: UseDispatch;
export declare const useStore: UseStore;
export declare const useSelector: UseSelector;

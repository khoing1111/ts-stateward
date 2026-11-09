// The parts of Redux 5's types the fixture uses.
export interface Action {
  type: string;
}
export type Unsubscribe = () => void;
export interface Store<S = unknown> {
  getState(): S;
  dispatch(action: Action): Action;
  subscribe(listener: () => void): Unsubscribe;
}
export declare function createStore<S>(reducer: (state: S | undefined, action: Action) => S): Store<S>;

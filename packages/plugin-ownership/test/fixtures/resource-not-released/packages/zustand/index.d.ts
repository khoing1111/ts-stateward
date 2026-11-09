// The parts of zustand 5's vanilla types the fixture uses.
export interface StoreApi<T> {
  getState(): T;
  setState(partial: Partial<T>): void;
  subscribe(listener: (state: T, previous: T) => void): () => void;
}
export declare function createStore<T>(initializer: () => T): StoreApi<T>;

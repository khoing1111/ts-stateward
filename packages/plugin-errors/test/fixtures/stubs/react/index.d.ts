// The part of React's API the boundary fixtures use, declared the way @types/react does.
export interface ReactElement {
  readonly type: unknown;
  readonly props: unknown;
}
export type ReactNode = ReactElement | string | number | boolean | null | undefined | ReactNodeList;
export interface ReactNodeList extends ReadonlyArray<ReactNode> {}
export type ComponentType<P = object> = (props: P) => ReactNode;
export declare class Component<P = object, S = object> {
  constructor(props: P);
  readonly props: Readonly<P> & { readonly children?: ReactNode };
  state: Readonly<S>;
  setState(state: S): void;
  render(): ReactNode;
}
export declare function useState<S>(initial: S): [S, (next: S) => void];
export declare function useEffect(effect: () => void, deps?: readonly unknown[]): void;
export interface Context<T> {
  Provider(props: { value: T; children?: ReactNode }): ReactElement;
}
export declare function createContext<T>(defaultValue: T): Context<T>;
export declare function useContext<T>(context: Context<T>): T;
export declare function StrictMode(props: { children?: ReactNode }): ReactElement;

declare global {
  namespace JSX {
    interface Element extends ReactElement {}
    interface IntrinsicElements {
      [tag: string]: { children?: ReactNode; [prop: string]: unknown };
    }
    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}

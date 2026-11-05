declare module "store-kit" {
  export function create<S>(): (init: () => S) => () => S;
  export const useSelector: {
    <T>(select: (state: unknown) => T): T;
    withTypes<S>(): <T>(select: (state: S) => T) => T;
  };
}

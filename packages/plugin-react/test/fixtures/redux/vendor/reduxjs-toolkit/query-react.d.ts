// The shape of RTK Query's React API the fixture uses: generated hooks by endpoint name.
export type QueryResult<T> = { data: T | undefined; isLoading: boolean; refetch: () => void };
export type MutationTrigger<A> = (arg: A) => Promise<void>;
export type Api = {
  useGetItemsQuery(arg: string): QueryResult<string[]>;
  useLazyGetItemsQuery(): [(arg: string) => void, QueryResult<string[]>];
  useSaveItemMutation(): [MutationTrigger<string>, { isLoading: boolean }];
  injectEndpoints(definition: { endpoints: unknown }): Api;
};
export declare function createApi(definition: { reducerPath: string }): Api;

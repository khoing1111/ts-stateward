// The parts of RTK Query 2's types the fixture uses (cacheLifecycle.d.ts), with the same names.
// `cacheDataLoaded` rejects when the entry is removed before data arrives; `cacheEntryRemoved`
// only resolves.
export interface CacheLifecyclePromises<ResultType = unknown, MetaType = unknown> {
  cacheDataLoaded: Promise<{ data: ResultType; meta: MetaType }>;
  cacheEntryRemoved: Promise<void>;
}
export interface QueryCacheLifecycleApi<ResultType> extends CacheLifecyclePromises<ResultType> {
  updateCachedData(updateRecipe: (draft: ResultType) => void | ResultType): void;
}
export interface QueryDefinition<ResultType, QueryArg> {
  queryFn(arg: QueryArg): { data: ResultType };
  onCacheEntryAdded?(
    arg: QueryArg,
    api: QueryCacheLifecycleApi<ResultType>,
  ): Promise<void> | void;
}
export interface EndpointBuilder {
  query<ResultType, QueryArg>(
    definition: QueryDefinition<ResultType, QueryArg>,
  ): QueryDefinition<ResultType, QueryArg>;
}
export declare function createApi<Definitions>(options: {
  reducerPath: string;
  endpoints(builder: EndpointBuilder): Definitions;
}): { endpoints: Definitions };

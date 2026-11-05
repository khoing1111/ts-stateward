// Stub types shaped like RTK Query's mutation hooks: the trigger's promise resolves to data or an
// error and has `unwrap()`, which rejects instead. No package is installed.
export type FetchError = { status: number; data: unknown };
export type MutationResult<T> =
  | { data: T; error?: undefined }
  | { data?: undefined; error: FetchError };
export type MutationTrigger<A, T> = (
  arg: A,
) => Promise<MutationResult<T>> & { unwrap(): Promise<T>; reset(): void };
export type MutationState = { isLoading: boolean; isError: boolean; error?: FetchError };
export type UseMutation<A, T> = () => readonly [MutationTrigger<A, T>, MutationState];

export type Settings = { theme: string };
export type Plan = { id: string; name: string };
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export declare const useDeletePlanMutation: UseMutation<string, void>;
export declare const useSendReplyMutation: UseMutation<{ threadId: string; text: string }, void>;
export declare const useSaveSettingsMutation: UseMutation<Settings, Settings>;
export declare const useCreatePlanMutation: UseMutation<{ name: string }, Plan>;
export declare function saveUser(name: string): Promise<Result<void, Error>>;
export declare const toast: { success(text: string): void; error(text: string): void };

export type Folder = { id: string; name: string; archived?: boolean };
export declare const useUpdateFolderMutation: UseMutation<Folder, Folder>;
// RTK Query's `dispatch(api.endpoints.getFolder.initiate(id))`: the promise resolves to the
// query's state, which carries `isError` as well as `error`.
export type QueryState<T> =
  | { data: T; error?: undefined; isError: false; isSuccess: true }
  | { data?: T; error: FetchError; isError: true; isSuccess: false };
export type QueryThunk<T> = { readonly endpoint: string; readonly arg: unknown; readonly t?: T };
export declare function dispatch<T>(
  action: QueryThunk<T>,
): Promise<QueryState<T>> & { unwrap(): Promise<T>; abort(): void };
export declare const getFolder: { initiate(id: string): QueryThunk<Folder> };

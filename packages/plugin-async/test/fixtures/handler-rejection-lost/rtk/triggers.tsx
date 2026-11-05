// RTK Query's mutation and lazy-query triggers, written as their types are,
// with no library: awaited without `.unwrap()` they resolve with `{ data }` or `{ error }` and
// never reject.
type FetchBaseQueryError = { status: number; data: unknown };
type SerializedError = { message?: string };
type QueryResult<T> =
  | { data: T; error?: undefined }
  | { data?: undefined; error: FetchBaseQueryError | SerializedError };
type MutationTrigger<A, T> = (arg: A) => Promise<QueryResult<T>> & {
  unwrap(): Promise<T>;
  abort(): void;
};
type LazyQueryTrigger<A, T> = (arg: A) => Promise<QueryResult<T>> & { unwrap(): Promise<T> };

declare function useAddTodoMutation(): readonly [MutationTrigger<string, { id: number }>, unknown];
declare function useLazyGetTodosQuery(): readonly [LazyQueryTrigger<void, string[]>, unknown];
declare function showError(error: unknown): void;

export function TodoForm() {
  const [addTodo] = useAddTodoMutation();
  const [loadTodos] = useLazyGetTodosQuery();
  return (
    <div>
      <button
        onClick={async () => {
          const result = await addTodo("milk");
          if (result.error !== undefined) showError(result.error);
        }}
      />
      <button
        onClick={async () => {
          await loadTodos();
        }}
      />
      {/* `.unwrap()` rejects with the error: this one is reported. */}
      <button
        onClick={async () => {
          await addTodo("bread").unwrap();
        }}
      />
    </div>
  );
}

// The project's own Result helper: `err` wraps a failure the caller can see.
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

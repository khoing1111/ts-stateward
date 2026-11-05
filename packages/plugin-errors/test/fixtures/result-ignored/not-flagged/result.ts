// The project's own Result: no library, recognised by its shape (`ok: true` / `ok: false`).
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function tryCatch<T, E>(fn: () => T, onError: (error: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (error) {
    return err(onError(error));
  }
}

export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onError: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(onError(error));
  }
}

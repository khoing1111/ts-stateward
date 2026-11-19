export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

declare const id: number;
declare function loadUser(id: number): Promise<Result<string, Error>>;

// Returns the Result the call gives: the failed branch can be returned as it is.
export async function same(): Promise<Result<string, Error>> {
  await loadUser(id);
  return { ok: true, value: "done" };
}

// Returns nothing: the failure is handled, never returned.
export async function other(): Promise<void> {
  await loadUser(id);
}

// Not async: `await` needs the function to be async first.
export function notAsync(): void {
  loadUser(id);
}

// A name the function already uses is not taken for the checked Result.
export async function taken(saved: string): Promise<void> {
  await loadUser(id);
  void saved;
}

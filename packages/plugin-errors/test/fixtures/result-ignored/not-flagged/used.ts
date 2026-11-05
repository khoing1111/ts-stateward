import { err, map, ok, type Result } from "./result.js";

declare const user: string;
declare const id: number;
declare function saveUser(user: string): Result<void, Error>;
declare function loadUser(id: number): Promise<Result<string, Error>>;
declare function log(value: unknown): void;
declare function consume(result: Result<void, Error>): void;

export function used(): Result<void, Error> {
  const saved = saveUser(user);
  if (!saved.ok) return saved;
  let again = saveUser(user);
  again = saveUser(user);
  if (saveUser(user).ok) log("saved");
  const flag = saveUser(user).ok ? 1 : 2;
  log(flag);
  log(saveUser(user));
  consume(saveUser(user));
  const mapped = map(saveUser(user), () => 1);
  log([mapped, again, ...[saveUser(user)]]);
  const { ok: succeeded } = saveUser(user);
  log(succeeded);
  return saveUser(user);
}

export const arrow = (): Result<void, Error> => saveUser(user);

export async function usedAsync(): Promise<Result<string, Error>> {
  const loaded = await loadUser(id);
  const pending = loadUser(id);
  log(pending);
  log(await loadUser(id));
  if (!loaded.ok) return err(loaded.error);
  return await loadUser(id);
}

export function passedOn(): Promise<Result<string, Error>> {
  return loadUser(id);
}

export function wrapped(): Result<number, never> {
  return ok(1);
}

/** Handed to a function that takes it: passed on, not dropped. */
declare function ignoreResult(result: unknown, reason: string): void;

export async function ignored(): Promise<void> {
  ignoreResult(saveUser(user), "the audit copy is best effort");
  ignoreResult(await loadUser(id), "the next read loads it again");
}

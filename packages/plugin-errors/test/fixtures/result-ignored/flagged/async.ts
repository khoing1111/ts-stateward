import { err, ok, tryCatchAsync, type Result } from "./result.js";

declare const id: number;
declare function loadUser(id: number): Promise<Result<string, Error>>;

async function inferred(flag: boolean) {
  return flag ? ok(1) : err(new Error("no"));
}

export async function dropped(): Promise<void> {
  await loadUser(id);
  void loadUser(id);
  loadUser(id);
  void (await loadUser(id));
  await inferred(true);
  await tryCatchAsync(() => Promise.resolve(1), () => new Error("failed"));
}

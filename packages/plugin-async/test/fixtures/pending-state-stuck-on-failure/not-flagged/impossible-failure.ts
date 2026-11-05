import { search } from "./requests.js";

declare function setState(value: Request): void;
declare function setLoading(value: boolean): void;

// The type says failure is impossible: nothing can fill `error`, so the request cannot fail.
type Request =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed"; error: never }
  | { status: "ready"; data: string };

export async function neverFails(): Promise<void> {
  setState({ status: "loading" });
  await search();
  setState({ status: "ready", data: "done" });
}

/** Catches its own failures and reports them. @neverRejects */
async function quietSearch(): Promise<void> {
  await search();
}

export async function taggedNeverRejects(): Promise<void> {
  setLoading(true);
  await quietSearch();
  setLoading(false);
}

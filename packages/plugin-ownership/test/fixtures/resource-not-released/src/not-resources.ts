// Values whose types have `[Symbol.dispose]` from TypeScript's library or a package, which never
// need a release: none is reported.
import { fn, stubGlobal } from "mocklib";

const failed = new Map<string, number>();

export function listFailed(): { keys: Iterable<string> } {
  const keys = failed.keys();
  return { keys };
}

function* letters(): Generator<string> {
  yield "a";
}

export function useLetters(): string[] {
  const all = letters();
  return Array.from(all);
}

export function setup(): void {
  const mock = fn();
  stubGlobal("ResizeObserver", mock);
}

// Array-likes are read by position like arrays: the rule is about keyed lookups (found on real
// apps: `match[1]` of a RegExp match, `files[0]` of a FileList, `node.arguments[0]`).
interface Files {
  readonly length: number;
  item(index: number): string | null;
  [index: number]: string;
}
interface Nodes<T> extends ReadonlyArray<T> {
  readonly pos: number;
}
class Stack<T> extends Array<T> {}

declare const files: Files;
declare const nodes: Nodes<string>;
declare const stack: Stack<number>;

const match = /^(\d{4})-(\d{2})$/.exec("2026-11");

export function parse(): number | undefined {
  if (!match) return undefined;
  return Number(match[1]) + Number(match[2]);
}

export const first = files[0];
export const firstNode = nodes[0];
export const top = stack[0];
export const words = "a b".match(/(\w+) (\w+)/)?.[1];

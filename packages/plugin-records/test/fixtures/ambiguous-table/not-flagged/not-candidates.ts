const key = "a";

// Already typed by their keys.
export const plain = { idle: "Idle", done: "Done" };
export const typed: Record<"idle" | "done", string> = { idle: "Idle", done: "Done" };
export const checked = { idle: "Idle" } satisfies Record<string, string>;

// No keys to fix.
export const empty: Record<string, string> = {};
export const emptyMap = new Map<string, string>();
export const emptyPairs = new Map<string, string>([]);

// Keys that are not literal.
export const computed: Record<string, string> = { [key]: "x" };
export const spreading: Record<string, string> = { ...plain, extra: "y" };
export const computedMap = new Map<string, string>([[key, "x"]]);
export const loadedMap = new Map<string, string>(Object.entries(plain));
export const wideMap: Map<string, string> = new Map([["a", "b"]] as const);

// Not a const or let, or not initialised here.
var oldStyle: Record<string, string> = { a: "x" };
export const declared = oldStyle;

export function parameters(given: Record<string, string> = { a: "x" }): string | undefined {
  return given.a;
}

export class Holder {
  static table: Record<string, string> = { a: "x" };
}

export const nested = { inner: { a: "x" } as Record<string, string> };

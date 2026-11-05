export enum Color {
  Red,
  Blue,
}

export const distinct = new Map([
  ["recent", 1],
  ["people", 2],
]);

// "1" and 1 are different keys of a Map.
export const mixed = new Map<string | number, string>([
  ["1", "text"],
  [1, "number"],
]);

export function build(first: string, second: string, others: readonly (readonly [string, number])[]) {
  return new Map<string, number>([
    [first, 1],
    [second, 2],
    [first, 3],
    ...others,
    ...others,
  ]);
}

export const colors = new Set([Color.Red, Color.Blue]);

export const later = new Map<string, number>([["a", 1]]);
later.set("a", 2);

// A class of the project that happens to be called Map is not the built-in one.
class Map2 {}
export const own = new Map2();

export const empty = new Map();
export const fromEntries = new Map(Object.entries({ a: 1 }));
export const weak = new WeakSet<object>();

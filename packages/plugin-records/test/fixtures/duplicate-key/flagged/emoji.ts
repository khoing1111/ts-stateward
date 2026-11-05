export const RECENT = "recent";

export enum Color {
  Red,
  Blue,
}

export const groups = new Map([
  ["recent", 1],
  ["people", 2],
  ["recent", 3],
]);

export const viaConstant = new Map([
  ["recent", 1],
  [RECENT, 2],
]);

export const byColor = new Map([
  [Color.Red, "red"],
  [Color.Blue, "blue"],
  [Color.Red, "crimson"],
]);

export const ids = new Set([1, 2, 3, 2]);

export const threeTimes = new Map<string, number>([
  ["a", 1],
  ["b", 2],
  ["a", 3],
  ["a", 4],
]);

export const asConst = new Map([
  ["x", 1],
  ["x", 2],
] as const);

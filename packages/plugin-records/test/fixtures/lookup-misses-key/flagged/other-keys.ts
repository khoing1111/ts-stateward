enum Color {
  Red = "red",
  Blue = "blue",
}

declare const color: Color;
declare const level: 1 | 2 | 3;
declare const word: "alpha" | "bravo" | "charlie" | "delta" | "echo";

const names: Record<string, string> = {};
const sizes: Record<number, string> = {};

export const enumKey = names[color];
export const numberKey = sizes[level];
export const long = names[word];

export function generic<K extends "a" | "b">(map: Record<string, string>, key: K): string {
  return map[key];
}

export const single = names["only"];

export const readInsideExpression = [names[color]].length + (names[color]).length;

export const constant = sizes[3] + names[Color.Blue].length;

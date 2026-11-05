import { NotFoundError, ParseError } from "./errors.js";

export function direct(id: string): string {
  if (id === "") throw new NotFoundError(id);
  return id;
}

export function builtins(text: string): unknown {
  return JSON.parse(decodeURIComponent(text));
}

export function nothing(a: number): number {
  return a + 1;
}

export function wrapped(): never {
  throw new ParseError("bad");
}

export const arrow = (n: number): string => n.toFixed(2);

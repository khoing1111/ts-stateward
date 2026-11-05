import { ParseError } from "./errors.js";

/** @throws {never} */
export function safe(): number {
  return 1;
}

/**
 * Reads a name.
 * @throws {ParseError} when it is empty
 */
export function declared(text: string): string {
  if (text === "") throw new ParseError("empty");
  return text;
}

export function usesDeclared(): string {
  return declared("") + String(safe());
}

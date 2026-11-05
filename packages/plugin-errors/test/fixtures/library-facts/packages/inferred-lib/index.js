import { decode } from "./decode.js";

export class LibError extends Error {}

export function load(text) {
  if (text === "") throw new LibError("empty");
  return decode(text);
}

export function each(fn) {
  fn();
}

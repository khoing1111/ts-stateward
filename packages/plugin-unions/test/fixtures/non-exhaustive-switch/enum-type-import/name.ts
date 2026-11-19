import type { Color } from "./colors.js";

export function other(c: Color): string {
  if (c.length > 3) return "";
  switch (c) {
    default:
      return "x";
  }
}

export function none(c: Color): string {
  switch (c) {
  }
  return "x";
}

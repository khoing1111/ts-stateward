import { Color, Dir as Direction } from "./color.js";

enum Local {
  A,
  B,
}

declare const color: Color;
declare const direction: Direction;
declare const local: Local;

// A numeric enum maps values back to names: `Color[0]` is "Red".
export const reverse = Color[color];
export const imported = Direction[direction];
export const own = Local[local];
export const parenthesized = (Color)[color];

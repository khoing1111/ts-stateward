import type { Opaque } from "./guarantees.js";

export type Point = Opaque<{ x: number; y: number }, "Point">;

export function point(x: number, y: number): Point | undefined {
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

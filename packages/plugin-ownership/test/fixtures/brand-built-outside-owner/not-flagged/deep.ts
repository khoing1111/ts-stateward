import type { Positive } from "./values.js";

declare const unknownValue: unknown;

// Only one level into a container is read: what a generic or a nested member holds is not.
export const a = unknownValue as Promise<Positive>;
export const b = unknownValue as { list: Positive[] };
export const c = unknownValue as Positive[][];
export const d = unknownValue as Map<string, Positive>;

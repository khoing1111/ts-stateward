import type { Opaque } from "./guarantees.js";

// Stated, with no constructor: only this module builds one.
export type Label = Opaque<string, "Label">;

export const DEFAULT_LABEL: Label = "none";

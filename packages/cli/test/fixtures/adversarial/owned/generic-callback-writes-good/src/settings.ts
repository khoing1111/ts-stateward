import type { Owned } from "./guarantees.js";

export type Item = { n: number };
export const settings: Owned<{ theme: string; meta: { n: number }; items: Item[] }> = {
  theme: "light",
  meta: { n: 0 },
  items: [],
};

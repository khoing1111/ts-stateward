import type { Owned } from "./guarantees.js";

export const settings: Owned<{ theme: string; reset(): void }> = {
  theme: "light",
  reset() {
    this.theme = "light";
  },
};

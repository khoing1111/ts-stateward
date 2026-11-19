import type { Actions } from "./contexts.js";

export const holder: { current: Actions } = { current: { save: () => undefined } };

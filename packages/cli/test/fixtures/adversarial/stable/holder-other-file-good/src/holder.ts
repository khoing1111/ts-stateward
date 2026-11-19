import type { Actions } from "./contexts.js";

export const holder: { readonly current: Actions } = { current: { save: () => undefined } };

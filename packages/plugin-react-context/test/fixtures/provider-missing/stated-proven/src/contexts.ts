import { requiredContext } from "./guarantees";

export type Theme = { dark: boolean };

export const ThemeCtx = requiredContext<Theme>();

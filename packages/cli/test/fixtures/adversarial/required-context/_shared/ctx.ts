import { requiredContext } from "./guarantees.js";

export type Theme = { color: string };

export const ThemeContext = requiredContext<Theme>();

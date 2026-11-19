import { requiredContext } from "./guarantees.js";
import type { Theme } from "./ctx.js";

export const OtherContext = requiredContext<Theme>();

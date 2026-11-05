import { formatSettings, ping } from "./format.js";
import { settings } from "./settings.js";

export const text = formatSettings(settings);
export const cycle = ping(settings, 2);

import { flags } from "./flags.js";

export function isBeta(): boolean {
  return flags.beta;
}

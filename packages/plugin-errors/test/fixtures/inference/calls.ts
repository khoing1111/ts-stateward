import { builtins, direct } from "./direct.js";

export function viaCalls(id: string): unknown {
  return builtins(direct(id));
}

import { reset } from "./reset.js";

export function relay(target: { theme: string }): void {
  reset(target);
}

import { session } from "./session.js";

export function counts(): number[] {
  return [session].map((s) => s.count);
}

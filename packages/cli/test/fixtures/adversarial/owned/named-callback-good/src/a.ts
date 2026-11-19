import { session } from "./session.js";

export function run(): number[] {
  return [session].map((s) => s.count);
}

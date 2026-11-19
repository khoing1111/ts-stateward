import { session } from "./session.js";

export function describe(target: typeof session): string {
  return target.user ?? "nobody";
}

export function current(): string {
  return describe(session);
}

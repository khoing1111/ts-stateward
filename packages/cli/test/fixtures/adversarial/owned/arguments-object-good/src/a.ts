import { session } from "./session.js";

function nameOf(target: { user: string | null }): string | null {
  return target.user;
}

export function run(): string | null {
  return nameOf(session);
}

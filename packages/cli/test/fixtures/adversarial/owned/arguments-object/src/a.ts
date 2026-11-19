import { session } from "./session.js";

function rename(_target: { user: string | null }): void {
  (arguments[0] as { user: string | null }).user = "x";
}

export function run(): void {
  rename(session);
}

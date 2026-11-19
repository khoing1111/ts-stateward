import { session } from "./session.js";

function change(a: { count: number }, b: number): void {
  a.count = b;
}

export function run(): void {
  const args: [{ count: number }, number] = [session, 1];
  change(...args);
}

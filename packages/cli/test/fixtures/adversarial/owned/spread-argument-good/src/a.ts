import { session } from "./session.js";

function add(a: number, b: number): number {
  return a + b;
}

export function run(): number {
  const args: [number, number] = [session.count, 1];
  return add(...args);
}

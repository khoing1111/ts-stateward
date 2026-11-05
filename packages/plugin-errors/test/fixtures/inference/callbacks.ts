import { direct } from "./direct.js";

export function parseAll(texts: readonly string[]): unknown[] {
  return texts.map((text) => JSON.parse(text));
}

export function findEach(ids: readonly string[]): void {
  ids.forEach(direct);
}

export function callsBack(fn: () => void): void {
  fn();
}

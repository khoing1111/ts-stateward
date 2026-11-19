export class AErr extends Error {}

/** @throws {AErr} */
export function show(n: number, base: number): string {
  if (base > 36) throw new AErr("x");
  return n.toString(base);
}

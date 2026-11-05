/** @throws {RangeError} */
export function documented(n: number): number {
  if (n < 0) throw new RangeError("negative");
  return n;
}

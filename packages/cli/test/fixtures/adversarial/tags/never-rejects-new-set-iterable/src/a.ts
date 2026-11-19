/** @neverRejects */
export async function uniq(xs: Iterable<string>): Promise<number> {
  return new Set(xs).size;
}

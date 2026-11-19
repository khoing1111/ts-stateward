/** @neverRejects */
export async function uniq(xs: string[]): Promise<number> {
  return new Set(xs).size;
}

/** @neverRejects */
export async function firstLen(xs: string[]): Promise<number> {
  return xs.at(0)?.length ?? 0;
}

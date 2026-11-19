/** @neverRejects */
export async function show(n: number, base: number): Promise<string> {
  return n.toString(base);
}

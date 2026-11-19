/** @neverRejects */
export async function first(): Promise<number> {
  return await Promise.any<number>([]);
}

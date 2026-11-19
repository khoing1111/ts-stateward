/** @neverRejects */
export async function first(): Promise<number> {
  try {
    return await Promise.any<number>([]);
  } catch {
    return 0;
  }
}

/** @neverRejects */
export async function make(size: number): Promise<number[]> {
  try {
    return new Array<number>(size);
  } catch {
    return [];
  }
}

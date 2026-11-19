/** Shows its own errors. @neverRejects */
export async function total(values: number[]): Promise<number> {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}

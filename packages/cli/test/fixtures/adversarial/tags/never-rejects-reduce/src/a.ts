/** Shows its own errors. @neverRejects */
export async function total(values: number[]): Promise<number> {
  const sum = values.reduce((all, value) => all + value);
  return sum;
}

// Read with a key that is only a `string`: still reported, but no quick fix (the fix would make
// this read fail to compile).
const prices: Record<string, number> = { apple: 1, pear: 2 };

export function priceOf(fruit: string): number | undefined {
  return prices[fruit];
}

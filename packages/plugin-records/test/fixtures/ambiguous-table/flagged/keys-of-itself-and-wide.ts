// One read takes its key from `Object.keys` of the record, another from a plain `string`: moving to
// `Object.entries` alone would not make the keys fixed, so the hint is the one for a wider key.
const stock: Record<string, number> = { bolts: 4, nuts: 9 };

export const stockLines = Object.keys(stock).map((item) => `${item}=${String(stock[item])}`);

export function stockOf(item: string): number | undefined {
  return stock[item];
}

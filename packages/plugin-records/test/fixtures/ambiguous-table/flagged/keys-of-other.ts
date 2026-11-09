// The keys come from another record, so there is nothing to take from `Object.entries` here: the
// keys of `rates` are typed first, as for any read with a wider key.
const rates: Record<string, number> = { day: 1, night: 2 };
export const periods: Record<string, string> = { day: "Day", night: "Night" };

export const rateLines = Object.keys(periods).map((key) => `${key}=${String(rates[key])}`);

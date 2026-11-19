export async function start(): Promise<void> {
  const { watchPrices } = await import("./prices.js");
  watchPrices(() => undefined);
}

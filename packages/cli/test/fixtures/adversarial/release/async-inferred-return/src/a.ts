import { watchPrices } from "./prices.js";

async function start() {
  return watchPrices(() => undefined);
}

export async function follow(): Promise<void> {
  await start();
}

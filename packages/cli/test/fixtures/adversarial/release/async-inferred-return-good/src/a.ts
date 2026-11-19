import { watchPrices } from "./prices.js";

function start() {
  return watchPrices(() => undefined);
}

export async function follow(): Promise<void> {
  const stop = start();
  try {
    await Promise.resolve();
  } finally {
    stop();
  }
}

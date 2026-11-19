import { watchPrices } from "./prices.js";

export async function follow(done: Promise<void>): Promise<void> {
  const stop = watchPrices(() => undefined);
  try {
    await done;
  } finally {
    stop();
  }
}

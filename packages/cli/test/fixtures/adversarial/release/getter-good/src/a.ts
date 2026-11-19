import { watchPrices } from "./prices.js";

class Feed {
  sub() {
    return watchPrices(() => undefined);
  }
}

export function follow(): void {
  const feed = new Feed();
  const stop = feed.sub();
  stop();
}

import { watchPrices } from "./prices.js";

class Feed {
  get sub() {
    return watchPrices(() => undefined);
  }
}

export function follow(): void {
  const feed = new Feed();
  void feed.sub;
}

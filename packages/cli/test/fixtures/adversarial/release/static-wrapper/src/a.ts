import { watchPrices } from "./prices.js";

export class Feed {
  static start() {
    return watchPrices(() => undefined);
  }
}

export function follow(): void {
  Feed.start();
}

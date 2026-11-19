import { watchPrices } from "./prices.js";

export class Feed {
  private stop: (() => void) | undefined;
  start(): void {
    this.stop = watchPrices(() => undefined);
  }
  dispose(): void {
    this.stop?.();
  }
}

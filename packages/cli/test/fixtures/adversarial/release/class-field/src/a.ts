import { watchPrices } from "./prices.js";

export class Feed {
  private stop = watchPrices(() => undefined);
  dispose(): void {
    void this.stop;
  }
}

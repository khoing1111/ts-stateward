import { watchPrices } from "./prices.js";

export class Feed {
  private stops: Array<() => void> = [];

  start(): void {
    this.stops.push(watchPrices(() => undefined));
  }

  dispose(all: boolean): void {
    for (const stop of this.stops) if (all) stop();
  }
}

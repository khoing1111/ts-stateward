import { watchPrices } from "./prices.js";

export class Feed {
  private stops: Array<() => void> = [];

  start(): void {
    this.stops.push(watchPrices(() => undefined));
  }

  dispose(): void {
    for (const stop of this.stops) stop();
    this.stops = [];
  }
}

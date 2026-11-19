import { useEffect } from "react";
import { watchPrices } from "./prices.js";

export function useFeed(on: boolean): void {
  useEffect(() => {
    const stop = watchPrices(() => undefined);
    return () => {
      if (on) stop();
    };
  }, [on]);
}

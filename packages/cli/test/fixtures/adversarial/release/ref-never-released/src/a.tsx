import { useEffect, useRef } from "react";
import { watchPrices } from "./prices.js";

export function useFeed(): void {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    stop.current = watchPrices(() => undefined);
  }, []);
}

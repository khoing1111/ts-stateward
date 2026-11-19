import { useEffect, useRef } from "react";
import { watchPrices } from "./prices.js";

export function useFeed(): void {
  const prices = useRef<(() => void) | null>(null);
  const other = useRef<(() => void) | null>(null);
  useEffect(() => {
    prices.current = watchPrices(() => undefined);
    return () => {
      other.current?.();
      prices.current?.();
    };
  }, []);
}

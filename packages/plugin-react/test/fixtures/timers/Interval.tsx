import { useEffect, useRef, useState } from "react";
import { store } from "./store.js";

/** The interval is started by a button; the unmount effect clears only a timeout. */
export function Ticker() {
  const [ticks, setTicks] = useState(0);
  const ticker = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(ticker.current), []);
  const start = () => {
    ticker.current = window.setInterval(() => {
      setTicks((current) => current + 1);
      store.dispatch({ type: "tick" });
    }, 1000);
  };
  return <button onClick={start}>{ticks}</button>;
}

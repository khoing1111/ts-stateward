import { useEffect, useRef } from "react";

/** The effect returns `stop`, which is written in the component, not in the effect. */
export function Poll({ onTick }: { onTick: () => void }) {
  const ticker = useRef<number | undefined>(undefined);
  const stop = () => {
    window.clearInterval(ticker.current);
  };
  useEffect(() => stop, []);
  const start = () => {
    ticker.current = window.setInterval(() => onTick(), 1000);
  };
  return <button onClick={start}>Start</button>;
}

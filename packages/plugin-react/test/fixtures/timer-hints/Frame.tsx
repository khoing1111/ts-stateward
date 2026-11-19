import { useRef, useState } from "react";

/** An animation frame kept in a ref that can be `undefined`: `cancelAnimationFrame` takes a number. */
export function Follower({ onMove }: { onMove: (x: number) => void }) {
  const [x, setX] = useState(0);
  const frame = useRef<number | undefined>(undefined);
  const follow = (to: number) => {
    frame.current = requestAnimationFrame(() => {
      setX(to);
      onMove(to);
    });
  };
  return <div onMouseMove={(event) => follow(event.clientX)}>{x}</div>;
}

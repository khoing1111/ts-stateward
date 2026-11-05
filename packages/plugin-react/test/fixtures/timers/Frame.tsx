import { useRef, useState } from "react";

/** An animation frame started by a handler; its callback writes to another ref. */
export function Follower() {
  const [x, setX] = useState(0);
  const frame = useRef<number | undefined>(undefined);
  const last = useRef(0);
  const follow = (to: number) => {
    frame.current = requestAnimationFrame(function step() {
      setX(to);
      last.current = to;
    });
  };
  return <div onMouseMove={(event) => follow(event.clientX)}>{x}</div>;
}

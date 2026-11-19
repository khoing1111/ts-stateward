import { useEffect, useRef } from "react";
import { stopAll } from "./stop.js";

/** The cleanup hands the ref to a function in another module, and the timer is a frame. */
export function Handed({ onClose }: { onClose: () => void }) {
  const frame = useRef<number | undefined>(undefined);
  useEffect(() => () => stopAll(frame), []);
  const leave = () => {
    frame.current = requestAnimationFrame(() => onClose());
  };
  return <span onMouseLeave={leave}>bye</span>;
}

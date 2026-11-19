import { useRef } from "react";

/** A timeout kept in a ref that can be `null`: `clearTimeout(null)` does not compile. */
export function Chip({ onClose }: { onClose: () => void }) {
  const closeTimer = useRef<number | null>(null);
  const leave = () => {
    closeTimer.current = window.setTimeout(() => onClose(), 150);
  };
  return <button onMouseLeave={leave}>Close</button>;
}

/** A timeout and a frame kept in two refs of one component are cleared by one effect each. */
export function Both({ onClose }: { onClose: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const leave = () => {
    timer.current = window.setTimeout(() => onClose(), 150);
    timer.current = requestAnimationFrame(() => onClose());
  };
  return <button onMouseLeave={leave}>Close</button>;
}

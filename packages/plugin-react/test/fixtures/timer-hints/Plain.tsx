import * as React from "react";

/** A timeout in a ref typed `number | undefined`: the plain clear compiles. */
export function Plain({ onClose }: { onClose: () => void }) {
  const closeTimer = React.useRef<number | undefined>(undefined);
  const leave = () => {
    closeTimer.current = window.setTimeout(() => onClose(), 150);
  };
  return <button onMouseLeave={leave}>Close</button>;
}

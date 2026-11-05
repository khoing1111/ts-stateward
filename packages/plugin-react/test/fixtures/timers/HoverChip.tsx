import { useRef, useState } from "react";

/** The close timer is set in a handler, nothing clears it on unmount, and it calls a prop. */
export function HoverChip({ label, onClose }: { label: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const enter = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      onClose();
    }, 150);
  };
  return (
    <span onMouseEnter={enter} onMouseLeave={leave}>
      {label}
      {open ? <b>open</b> : null}
    </span>
  );
}

/** Only this component's own state is set after the delay: React ignores it after unmount. */
export function LocalChip({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  return (
    <span onMouseLeave={leave}>
      {label}
      {open ? <b>open</b> : null}
    </span>
  );
}

import { useEffect, useRef, useState } from "react";
import { stopAll } from "./stop.js";

/** The timer is cleared by an effect that runs on unmount. */
export function ClearedChip({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  return <span onMouseLeave={() => { closeTimer.current = window.setTimeout(() => { setOpen(false); onClose(); }, 150); }}>{open ? "open" : "closed"}</span>;
}

/** Cleared through a copy of the id and a helper declared in the component. */
export function ClearedByHelper({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const stop = () => {
    const id = closeTimer.current;
    clearTimeout(id);
  };
  useEffect(() => stop, [open]);
  useEffect(() => {
    return () => stop();
  }, []);
  return <span onMouseLeave={() => { closeTimer.current = window.setTimeout(onClose, 150); }}>{String(open)}</span>;
}

/** The cleanup hands the ref to a function in another module: stateward cannot see what it does. */
export function Handed({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => stopAll(closeTimer), []);
  return <span onMouseLeave={() => { closeTimer.current = window.setTimeout(onClose, 150); }}>{String(open)}</span>;
}

/** The effect rule already reports this debounce; this rule says nothing more. */
export function Debounced({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  const [value, setValue] = useState(query);
  const debounce = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setValue(query);
      onSearch(query);
    }, 300);
  }, [query]);
  return <p>{value}</p>;
}

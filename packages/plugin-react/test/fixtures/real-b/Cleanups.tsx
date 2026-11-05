import { useEffect, useRef, useState } from "react";
import { registry } from "./registry.js";

/** The timer is cleared before each new one, and on unmount by an effect of its own. */
export function Highlighter({ id }: { id: string }) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(highlightTimeoutRef.current);
    setHighlight(id);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlight(null), 1500);
  }, [id]);
  useEffect(() => () => window.clearTimeout(highlightTimeoutRef.current), []);
  return <p>{highlight}</p>;
}

/** The same debounce with nothing that clears the timer on unmount. */
export function SearchField({ query }: { query: string }) {
  const [debounced, setDebounced] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(query), 300);
  }, [query]);
  return <p>{debounced}</p>;
}

/** The observer exists only where the browser has one, and is disconnected through `?.`. */
export function Panel() {
  const [width, setWidth] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const resizes =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    if (panelRef.current) resizes?.observe(panelRef.current);
    return () => resizes?.disconnect();
  }, []);
  return <div ref={panelRef}>{width}</div>;
}

/** The unsubscribe is kept in a variable and called through `?.()`. */
export function Status({ name }: { name: string }) {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const unregisterCallback = registry.subscribe(name, setOnline);
    return () => unregisterCallback?.();
  }, [name]);
  return <p>{online ? "online" : "offline"}</p>;
}

/** Subscribed only when enabled; the unsubscribe, if any, is called through `?.()`. */
export function OptionalStatus({ name, enabled }: { name: string; enabled: boolean }) {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const unregisterCallback = enabled ? registry.subscribe(name, setOnline) : undefined;
    return () => {
      unregisterCallback?.();
    };
  }, [name, enabled]);
  return <p>{online ? "online" : "offline"}</p>;
}

/** Cleared only on unmount, by another effect: a new `id` starts a second timer beside the first. */
export function Flash({ id }: { id: string }) {
  const [flash, setFlash] = useState<string | null>(null);
  const flashRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    flashRef.current = window.setTimeout(() => setFlash(id), 500);
  }, [id]);
  useEffect(() => () => window.clearTimeout(flashRef.current), []);
  return <p>{flash}</p>;
}

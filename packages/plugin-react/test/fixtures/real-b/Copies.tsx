import { useEffect, useRef, useState } from "react";

/** A debounce hook: the state lags behind the prop on purpose. */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** A throttle hook: set at once when enough time has passed, otherwise later. */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttled, setThrottled] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const elapsed = Date.now() - last.current;
    if (elapsed >= interval) {
      last.current = Date.now();
      setThrottled(value);
      return;
    }
    const id = window.setTimeout(() => {
      last.current = Date.now();
      setThrottled(value);
    }, interval - elapsed);
    return () => window.clearTimeout(id);
  }, [value, interval]);
  return throttled;
}

/** Counts how often `page` changed: the copy is the previous page, compared with the new one. */
export function PageChanges({ page }: { page: number }) {
  const [previous, setPrevious] = useState(page);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    setPrevious(page);
    setChanges((count) => count + 1);
  }, [page]);
  return (
    <p>
      {previous} {changes}
    </p>
  );
}

/** The user edits the title; the effect throws the edits away whenever `title` changes. */
export function TitleEditor({ title }: { title: string }) {
  const [draft, setDraft] = useState(title);
  useEffect(() => {
    setDraft(title);
  }, [title]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

/** The same draft in a hook. */
export function useDraft(initial: string): [string, (next: string) => void] {
  const [text, setText] = useState(initial);
  useEffect(() => {
    setText(initial);
  }, [initial]);
  return [text, setText];
}

/** A plain copy, never edited: still two sources of truth. */
export function Badge({ label }: { label: string }) {
  const [shown, setShown] = useState(label);
  useEffect(() => {
    setShown(label);
  }, [label]);
  return <span>{shown}</span>;
}

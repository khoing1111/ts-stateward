import { useCallback, useEffect, useState } from "react";

/** The interval keeps the first render's `count`, so it sets 1 every second. */
export function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <p>{count}</p>;
}

export function CounterFixed() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount((count) => count + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <p>{count}</p>;
}

/** `count` is a dependency, so the interval is made again after each tick and is never stale. */
export function CounterRestarted() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000);
    return () => clearInterval(id);
  }, [count]);
  return <p>{count}</p>;
}

/** The effect runs again when `step` changes, but not when `seconds` does. */
export function Countdown({ step }: { step: number }) {
  const [seconds, setSeconds] = useState(60);
  useEffect(() => {
    const id = setTimeout(() => setSeconds(seconds - step), 1000);
    return () => clearTimeout(id);
  }, [step]);
  return <p>{seconds}</p>;
}

export function Pager() {
  const [page, setPage] = useState(1);
  const next = useCallback(() => setPage(page + 1), []);
  const previous = useCallback(() => setPage((page) => page - 1), []);
  return (
    <p>
      <button onClick={previous}>previous</button>
      {page}
      <button onClick={next}>next</button>
      <button onClick={() => setPage(page + 1)}>next, from the handler</button>
    </p>
  );
}

export function Ticker({ deps }: { deps: readonly unknown[] }) {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTicks(ticks + 1), 1000);
    return () => clearInterval(id);
  }, deps);
  return <p>{ticks}</p>;
}

/** Runs once, so the value it reads is the current one. */
export function Starter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(count + 1);
  }, []);
  return <p>{count}</p>;
}

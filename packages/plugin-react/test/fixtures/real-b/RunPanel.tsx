import { useEffect, useState } from "react";

export type Run = { id: string; stop: () => void; retry: () => void };
export type RunHandlers = { onStop: () => void; onRetry: () => void };

const bound = new WeakMap<Run, RunHandlers>();

/** Memoized per run: the same handlers for the same run, every time. */
export function bindRunHandlers(run: Run): RunHandlers {
  const known = bound.get(run);
  if (known !== undefined) return known;
  const handlers = { onStop: () => run.stop(), onRetry: () => run.retry() };
  bound.set(run, handlers);
  return handlers;
}

export function RunPanel({ run }: { run: Run }) {
  const [stopped, setStopped] = useState(false);
  const handlers = bindRunHandlers(run);
  useEffect(() => {
    if (stopped) handlers.onStop();
  }, [stopped, handlers]);
  return <button onClick={() => setStopped(true)}>stop</button>;
}

/** A new run object each render: the memo misses every time. */
export function CopiedRunPanel({ run }: { run: Run }) {
  const handlers = bindRunHandlers({ ...run });
  useEffect(() => {
    handlers.onRetry();
  }, [handlers]);
  return <p>{run.id}</p>;
}

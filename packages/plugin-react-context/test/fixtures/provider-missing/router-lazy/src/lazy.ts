import { lazy, type JSX } from "react";

type Page = () => JSX.Element;

/** The app's own wrapper: hands the import to `lazy` as it is. */
export function lazyComponent(load: () => Promise<{ default: Page }>) {
  return lazy(load);
}

async function retry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    return load();
  }
}

/** A wrapper that does more than hand the import over: only the `lazyFunctions` option names it. */
export function withRetry(load: () => Promise<{ default: Page }>) {
  return lazy(() => retry(load));
}

import { lazy, type JSX } from "react";

type Page = () => JSX.Element;

async function retry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    return load();
  }
}

/** The app's own wrapper: it does more than hand the import over, so only `lazyFunctions` names it. */
export function load(factory: () => Promise<{ default: Page }>) {
  return lazy(() => retry(factory));
}

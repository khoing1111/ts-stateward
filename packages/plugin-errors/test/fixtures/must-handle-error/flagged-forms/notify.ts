import { Declined } from "./errors.js";

declare function toast(text: string): void;
declare function log(error: unknown): void;

/** Names the class, then throws it again: not handled. */
export function rethrowDeclined(error: unknown): void {
  if (error instanceof Declined) throw error;
  toast("Something went wrong.");
}

/** Tests the class only after something else: not a helper that starts by naming it. */
export function logThenShow(error: unknown): void {
  log(error);
  if (error instanceof Declined) toast("Declined.");
}

/** Calls a helper that names it, one level further than followed. */
export function relay(error: unknown): void {
  showDeclined(error);
}

function showDeclined(error: unknown): void {
  if (error instanceof Declined) toast("Declined.");
}

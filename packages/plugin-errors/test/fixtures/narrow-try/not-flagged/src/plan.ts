import toast from "react-hot-toast";
declare class RequestError extends Error {}
type Plan = { id: string; details: { title: string } };

/** @throws {RequestError} */
declare function getPlan(id: string): Promise<Plan>;
declare function showError(message: unknown): void;
declare function setTitle(title: string): void;
declare function isRequestError(error: unknown): error is RequestError;

export async function narrows(id: string): Promise<void> {
  try {
    const plan = await getPlan(id);
    setTitle(plan.details.title);
  } catch (e) {
    if (e instanceof RequestError) showError(e);
    else throw e;
  }
}

export async function typeGuard(id: string): Promise<void> {
  try {
    const plan = await getPlan(id);
    setTitle(plan.details.title);
  } catch (e) {
    if (isRequestError(e)) showError(e);
  }
}

export async function rethrows(id: string): Promise<void> {
  try {
    const plan = await getPlan(id);
    setTitle(plan.details.title);
  } catch (e) {
    showError(e);
    throw e;
  }
}

export async function alreadyNarrow(id: string): Promise<void> {
  let plan: Plan;
  try {
    plan = await getPlan(id);
  } catch (e) {
    showError(e);
    return;
  }
  setTitle(plan.details.title);
}

export async function linesThatCannotFail(id: string): Promise<boolean> {
  let loaded = false;
  try {
    await getPlan(id);
    loaded = true;
    return loaded;
  } catch (e) {
    showError(e);
    return false;
  }
}

// Each line can fail as expected: an awaited call stateward cannot follow may reject.
export async function everyLineExpected(
  id: string,
  onLoaded: (plan: Plan) => Promise<void>,
): Promise<void> {
  try {
    const plan = await getPlan(id);
    await onLoaded(plan);
  } catch (e) {
    showError(e);
  }
}

// Nothing known to fail as expected: the rule cannot tell what the try is for.
export function nothingExpected(): void {
  try {
    setTitle("x");
  } catch (e) {
    showError(e);
  }
}

// A built-in's methods on a value made with `new`, and a map write: not where bugs hide.
export function hostOf(url: string, seen: Map<string, string>): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    seen.set(url, host);
    return host;
  } catch {
    return null;
  }
}

// Parsed as `unknown`: TypeScript makes the code test it before reading it.
export function versionOf(text: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(text);
    if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
      return typeof manifest.version === "string" ? manifest.version : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// Reading what was parsed: a value of the wrong shape is the same failure as bad JSON, which the
// catch is for (real-world corpus: memos' stored preferences, excalidraw's share links, tldraw's files).
export function readCount(stored: string): number {
  let count = 0;
  try {
    const parsed: { count: number } = JSON.parse(stored);
    count = parsed.count;
  } catch {
    count = -1;
  }
  return count;
}

// The same for a response body read as JSON (real-world corpus: outline's API client fills the error
// from the body it parsed).
export async function errorFrom(response: Response): Promise<Error> {
  const error = new Error("request failed");
  try {
    const parsed: { message?: string } = await response.json();
    error.message = parsed.message ?? "";
  } catch {
    // the body may not be JSON
  }
  return error;
}

// No call here is awaited or known to throw: the toast is not a request, so the `try` has no
// purpose to name, and nothing is reported.
export function notifies(onSaved: () => void): void {
  try {
    toast.success("Saved");
    onSaved();
  } catch (e) {
    showError(e);
  }
}

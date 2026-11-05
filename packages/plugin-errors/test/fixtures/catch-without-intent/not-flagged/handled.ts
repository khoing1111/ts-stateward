declare function load(): Promise<string>;
declare function render(text: string | undefined): void;
declare function save(): void;
declare function showError(error: unknown): void;
declare function err(error: unknown): { ok: false; error: unknown };

export async function lastStatement(): Promise<void> {
  try {
    await load();
  } catch (e) {
    console.error(e);
  }
}

export async function lastStatementInABlock(flag: boolean): Promise<void> {
  if (flag) {
    try {
      await load();
    } catch {}
  }
}

export async function lastInALoopThatEndsTheFunction(items: readonly string[]): Promise<void> {
  for (const item of items) {
    try {
      save();
      render(item);
    } catch (e) {
      console.error(e);
    }
  }
}

export async function returns(): Promise<string | undefined> {
  try {
    return await load();
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

export async function returnsAFailure(): Promise<unknown> {
  try {
    await load();
  } catch (e) {
    return err(e);
  }
  return undefined;
}

export function throws(): void {
  try {
    save();
  } catch (e) {
    console.error(e);
    throw e;
  }
  render(undefined);
}

export function logsAndSetsState(): void {
  let failed = false;
  try {
    save();
  } catch (e) {
    console.error(e);
    failed = true;
  }
  render(failed ? "failed" : undefined);
}

export function emptyOnPurpose(): void {
  try {
    save();
  } catch {
    // best effort: the cache may not exist yet
  }
  render(undefined);
}

export function endsWithABareReturn(): void {
  try {
    save();
  } catch (e) {
    console.error(e);
  }
  return;
}

export function endsWithDeclarations(): void {
  try {
    save();
  } catch (e) {
    console.error(e);
  }
  function helper(): void {
    render(undefined);
  }
  type Unused = string;
}

export function leavesTheLoop(items: readonly string[]): void {
  for (const item of items) {
    try {
      save();
    } catch (e) {
      console.error(item, e);
    }
    break;
  }
}

export async function retryLoop(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await load();
    } catch (e) {
      console.warn("retrying", e);
    }
  }
  throw new Error("failed after 3 attempts");
}

export function retryUntilSaved(): void {
  for (;;) {
    try {
      save();
      break;
    } catch {}
  }
  render("saved");
}

export function eachItemBestEffort(items: readonly string[]): void {
  let index = 0;
  while (index < items.length) {
    index += 1;
    if (index > 1) {
      try {
        render(items[index]);
      } catch (e) {
        console.error(e);
      }
    }
  }
  render(undefined);
}

// A fallback: the try returns what it read, the line after returns a default (found on real apps,
// reading settings from localStorage).
declare const storage: { getItem(key: string): string | null };
declare const DEFAULT_WIDTH: number;

export function storedWidth(key: string): number {
  try {
    const stored = Number(storage.getItem(key));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch (error) {
    console.warn(`Failed to load ${key}:`, error);
  }
  return DEFAULT_WIDTH;
}

// A fallback assigned before the try: the variable already holds a value the code after the try
// can use, and the try only replaces it (found in the production corpus: feature flags and saved
// state read from localStorage, a copy command's success flag, an image resized when it can be).
type Flags = { beta: boolean };
declare const DEFAULT_FLAGS: Flags;
declare function resize(file: Blob): Promise<Blob>;
declare function copyCommand(): boolean;

export function readFlags(): Flags {
  let flags = DEFAULT_FLAGS;
  try {
    flags = JSON.parse(storage.getItem("flags") ?? "{}") as Flags;
  } catch (error) {
    console.warn(error);
  }
  return flags;
}

export function copied(): boolean {
  let success = false;
  try {
    success = copyCommand();
  } catch (error) {
    console.error(error);
  }
  return success;
}

export async function upload(file: Blob): Promise<number> {
  try {
    file = await resize(file);
  } catch (error) {
    console.error("could not resize", error);
  }
  return file.size;
}

// An empty catch with no comment is ESLint's `no-empty` (and Biome's `noEmptyBlockStatements`):
// stateward does not report it twice.
export async function emptyWithoutAComment(): Promise<void> {
  let text: string | undefined;
  try {
    text = await load();
  } catch (e) {}
  render(text);
}

// A catch that tests the error is narrowing: `errors/catch-hides-unexpected` checks the rest.
export function narrows(): void {
  try {
    save();
  } catch (e) {
    if (e instanceof TypeError) console.error(e);
  }
  render(undefined);
}

// Handing the error to the caller's callback passes it on, like a rethrow.
export function passesItOn(next: (error: unknown) => void): void {
  try {
    save();
  } catch (e) {
    next(e);
  }
  render(undefined);
}

export function inAPromise(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      save();
    } catch (e) {
      reject(e);
    }
    resolve();
  });
}

// Each failure kept for the message after the loop (found in the corpus: font URLs tried in turn).
export function firstThatLoads(urls: readonly string[]): string {
  const failures: string[] = [];
  let index = 0;
  while (index < urls.length) {
    try {
      save();
      return urls[index] ?? "";
    } catch (e) {
      failures.push(`${urls[index] ?? ""}: ${String(e)}`);
    }
    index += 1;
  }
  return failures.join("\n");
}

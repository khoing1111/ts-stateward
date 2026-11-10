/** Ends in a `.catch` that does not throw: cannot reject. */
export function track(name: string): Promise<void> {
  return fetch(`/track/${name}`)
    .then(() => undefined)
    .catch(() => undefined);
}

/** Awaits only what cannot reject. */
export async function refresh(): Promise<void> {
  await track("refresh");
}

/** Returns a value, awaits nothing. */
export async function bump(n: number): Promise<number> {
  return n + 1;
}

/** Catches its own failure and returns a value from the catch. */
export async function loadSafe(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    return await response.text();
  } catch {
    return undefined;
  }
}

/** Can reject: `fetch` outside a try. */
export async function loadUnsafe(url: string): Promise<void> {
  await fetch(url);
}

/** Can reject: it calls a function that can. */
export async function reload(): Promise<void> {
  await loadUnsafe("/a");
}

/** Can reject: the promise it awaits is held in a variable, not followed. */
export async function settle(pending: Promise<void>): Promise<void> {
  await pending;
}

/** Can reject: a `.then` keeps the failure of `fetch`. */
export function ping(): Promise<void> {
  return fetch("/ping").then(() => undefined);
}

/** Can reject: the promises in a list built elsewhere are not followed. */
export function all(urls: string[]): Promise<Response[]> {
  return Promise.all(urls.map((url) => fetch(url)));
}

/** Can reject: the `.catch` rethrows. */
export function rethrows(): Promise<Response> {
  return fetch("/r").catch((error: unknown) => {
    console.error(error);
    throw error;
  });
}

/** Can reject: the `.then` callback returns a request. */
export function chained(): Promise<Response> {
  return Promise.resolve("token").then((token) => fetch(`/me?t=${token}`));
}

/** Can reject: the second `.then` callback rethrows. */
export function handledThenThrown(): Promise<unknown> {
  return fetch("/h").then(
    (response) => response.status,
    (error: unknown) => {
      throw error;
    },
  );
}

/** Can reject: `for await` reads promises it does not follow. */
export async function lines(source: AsyncIterable<string>): Promise<void> {
  for await (const line of source) console.log(line);
}

/** Can reject: two functions that call each other, one with a request. */
export async function ping2(n: number): Promise<void> {
  if (n > 0) await pong2(n - 1);
  await fetch("/p");
}
export async function pong2(n: number): Promise<void> {
  if (n > 0) await ping2(n - 1);
}

/** A chain five calls deep that ends in a function catching its own failure: cannot reject. */
export async function deepSafe5(): Promise<void> {
  try {
    await fetch("/x");
  } catch {
    // reported elsewhere
  }
}
export async function deepSafe4(): Promise<void> {
  await deepSafe5();
}
async function deepSafe3(): Promise<void> {
  await deepSafe4();
}
async function deepSafe2(): Promise<void> {
  await deepSafe3();
}
export async function deepSafe1(): Promise<void> {
  await deepSafe2();
}

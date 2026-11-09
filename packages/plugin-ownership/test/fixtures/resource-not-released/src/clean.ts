import { interval } from "rxjs";
import { createApi } from "@reduxjs/toolkit/query/react";
import { doc, onSnapshot } from "firebase/firestore";
import { open, type Connection } from "./connection";
import type { Release } from "./guarantees";
import { watchPrices } from "./prices";

declare function load(): Promise<void>;

export function returned(): () => void {
  return watchPrices(() => undefined);
}

export function released(): void {
  const stop = watchPrices(() => undefined);
  stop();
}

export async function releasedInFinally(): Promise<void> {
  const stop = watchPrices(() => undefined);
  try {
    await load();
  } finally {
    stop();
  }
}

export function handedOver(keep: (release: Release<() => void>) => void): void {
  keep(watchPrices(() => undefined));
}

export function cleanup(): () => void {
  const stop = watchPrices(() => undefined);
  return () => stop();
}

export function usingIt(): void {
  using connection = open();
  connection.query();
}

export function rx(): void {
  const subscription = interval(1000).subscribe(() => undefined);
  subscription.unsubscribe();
}

export function firestore(): () => void {
  const unsubscribe = onSnapshot(doc("orders/1"), () => undefined);
  return unsubscribe;
}

export class Holder {
  private stop: (() => void) | undefined;

  start(): void {
    this.stop = watchPrices(() => undefined);
  }

  end(): void {
    this.stop?.();
  }
}

// A method that returns its own object starts nothing new.
export function chained(connection: Connection): void {
  connection.on("close");
}

// RTK Query's streaming pattern: `cacheEntryRemoved` only resolves, so the release after it runs.
export const messagesApi = createApi({
  reducerPath: "messages",
  endpoints: (builder) => ({
    messages: builder.query<string[], string>({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(channel, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        try {
          await cacheDataLoaded;
        } catch {
          return;
        }
        const unsubscribe = onSnapshot(doc(channel), () => updateCachedData((draft) => draft));
        await cacheEntryRemoved;
        unsubscribe();
      },
    }),
  }),
});

/** Stored in a field and returned from the same method: the caller gets it (RxJS's `_subscribe`). */
export class Relay {
  private inner: { unsubscribe(): void } | undefined;
  open(): { unsubscribe(): void } {
    this.inner = interval(1000).subscribe(() => undefined);
    return this.inner;
  }
}

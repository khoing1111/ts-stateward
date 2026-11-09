import { interval } from "rxjs";
import { createApi } from "@reduxjs/toolkit/query/react";
import { createStore } from "redux";
import { createStore as createVanilla } from "zustand";
import { doc, onSnapshot } from "firebase/firestore";
import { open } from "./connection";
import { watchPrices } from "./prices";

declare function register(callback: () => void): void;
declare function load(): Promise<void>;

export function dropped(): void {
  watchPrices(() => undefined);
}

export function neverCalled(): number {
  const stop = watchPrices(() => undefined);
  return typeof stop === "function" ? 1 : 0;
}

export function someWays(flag: boolean): void {
  const stop = watchPrices(() => undefined);
  if (flag) stop();
}

export async function failedAwait(): Promise<void> {
  const stop = watchPrices(() => undefined);
  await load();
  stop();
}

export function passed(): void {
  const stop = watchPrices(() => undefined);
  register(stop);
}

export function inArray(): (() => void)[] {
  const stop = watchPrices(() => undefined);
  return [stop];
}

export class Holder {
  private stop: (() => void) | undefined;

  start(): void {
    this.stop = watchPrices(() => undefined);
  }
}

export function rx(): void {
  const subscription = interval(1000).subscribe(() => undefined);
  void subscription;
}

export function redux(): void {
  const store = createStore((state: number | undefined) => state ?? 0);
  const unsubscribe = store.subscribe(() => undefined);
  void unsubscribe;
}

export function zustand(): void {
  createVanilla(() => ({ count: 0 })).subscribe(() => undefined);
}

export function firestore(): void {
  const unsubscribe = onSnapshot(doc("orders/1"), () => undefined);
  void unsubscribe;
}

// `cacheDataLoaded` rejects when the entry is removed before data arrives: the release is skipped.
export const ordersApi = createApi({
  reducerPath: "orders",
  endpoints: (builder) => ({
    order: builder.query<string, string>({
      queryFn: () => ({ data: "" }),
      async onCacheEntryAdded(id, { cacheDataLoaded, cacheEntryRemoved }) {
        const unsubscribe = onSnapshot(doc(id), () => undefined);
        await cacheDataLoaded;
        await cacheEntryRemoved;
        unsubscribe();
      },
    }),
  }),
});

export function disposable(): void {
  const connection = open();
  connection.query();
}

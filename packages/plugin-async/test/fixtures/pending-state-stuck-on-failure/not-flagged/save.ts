import { api, safely, search, store, submit } from "./requests.js";

declare function report(error: unknown): void;
declare function setLoading(value: boolean): void;
declare function setData(value: string[]): void;
declare function setBusy(value: boolean): void;


export async function inFinally(): Promise<void> {
  setLoading(true);
  try {
    await search();
  } finally {
    setLoading(false);
  }
}

export async function catchAndAfter(): Promise<void> {
  setLoading(true);
  try {
    await search();
  } catch (error) {
    setLoading(false);
    throw error;
  }
  setLoading(false);
}

export async function swallowed(): Promise<void> {
  setBusy(true);
  try {
    await search();
  } catch (error) {
    report(error);
  }
  setBusy(false);
}

export async function earlyReturnResets(): Promise<void> {
  setLoading(true);
  try {
    const result = await submit();
    if (!result.ok) {
      setLoading(false);
      return;
    }
  } catch (error) {
    setLoading(false);
    throw error;
  }
  setLoading(false);
}

export function noAwait(items: string[]): number {
  setLoading(true);
  const count = items.length;
  setLoading(false);
  return count;
}

export async function insideTryWithReset(): Promise<void> {
  try {
    setLoading(true);
    await search();
    setLoading(false);
  } catch (error) {
    setLoading(false);
    report(error);
  }
}

export async function neverSetBack(): Promise<void> {
  setLoading(true);
  await search();
}

export function chainWithFinally(): void {
  setLoading(true);
  search().finally(() => {
    setLoading(false);
  });
}

export function chainWithCatch(): void {
  setLoading(true);
  search()
    .then(() => {
      setLoading(false);
    })
    .catch(() => {
      setLoading(false);
    });
}

export function chainCaughtFirst(): void {
  setLoading(true);
  search()
    .catch(report)
    .then(() => {
      setLoading(false);
    });
}

export async function notThisFlag(): Promise<void> {
  setLoading(true);
  await search();
  setBusy(false);
}

export async function localVariable(): Promise<number> {
  let attempts = 0;
  attempts = 1;
  await search();
  attempts = 2;
  return attempts;
}

export async function resultArrives(): Promise<void> {
  setData(await api.fetchAll(1));
  await search();
  setData([]);
}

export async function localObject(): Promise<string> {
  const progress = { step: "start" };
  progress.step = "loading";
  await search();
  progress.step = "done";
  return progress.step;
}

export class Editor {
  serverError = "";
  state = { error: null as string | null };

  async save(): Promise<void> {
    this.serverError = "";
    this.state = { error: null };
    await submit();
    this.serverError = "saved";
    this.state = { error: "none" };
  }
}

// A call stateward cannot follow (no body, no facts): it may never reject, so nothing is said.
declare function unknownRequest(): Promise<void>;

export async function unknownCall(): Promise<void> {
  setLoading(true);
  await unknownRequest();
  setLoading(false);
}

// An action that settles with its error in the value (RTK Query's triggers): it does not reject.
type Settled = Promise<{ data: string } | { error: unknown }> & { unwrap(): Promise<string> };
declare function addTodo(text: string): Settled;

export async function settles(): Promise<void> {
  setBusy(true);
  await addTodo("milk");
  setBusy(false);
}

// A project function that catches its own failure cannot reject.
async function searchQuietly(): Promise<void> {
  try {
    await search();
  } catch (error) {
    report(error);
  }
}

export async function quiet(): Promise<void> {
  setLoading(true);
  await searchQuietly();
  setLoading(false);
}

export async function throughStore(): Promise<void> {
  setLoading(true);
  const items = await store.loadItems();
  setLoading(false);
  if (items !== null) setData(items);
}

export async function throughWrapper(): Promise<void> {
  setLoading(true);
  const items = await safely(() => api.fetchAll(1));
  setLoading(false);
  if (items !== null) setData(items);
}

/** The `.catch` callback sets the state again, then rethrows: the state is not left behind. */
export async function catchCallbackResets(): Promise<void> {
  setBusy(true);
  await search().catch((error: unknown) => {
    setBusy(false);
    throw error;
  });
  setBusy(false);
}

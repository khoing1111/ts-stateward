import { api, search, submit } from "./requests.js";

declare function report(error: unknown): void;
declare function setLoading(value: boolean): void;
declare function setSubmitting(value: boolean): void;
declare function setBusy(value: boolean): void;
declare function setWaiting(value: boolean): void;
declare function setStatus(value: "idle" | "saving" | "saved"): void;

type RemoteData<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed"; error: unknown }
  | { status: "ready"; data: T };
declare function setState(value: RemoteData<string>): void;

export async function onSearch(): Promise<void> {
  setLoading(true);
  await search();
  setLoading(false);
}

export class Form {
  isSaving = false;

  async save(): Promise<void> {
    this.isSaving = true;
    await submit();
    this.isSaving = false;
  }
}

export async function load(state: { pending: boolean; items: string[] }): Promise<void> {
  state.pending = true;
  const items = await api.fetchAll(1);
  state.items = items;
  state.pending = false;
}

export async function send(): Promise<void> {
  setSubmitting(true);
  const result = await submit();
  if (!result.ok) {
    return;
  }
  setSubmitting(false);
}

export async function rethrow(): Promise<void> {
  setBusy(true);
  try {
    await search();
  } catch (error) {
    throw error;
  }
  setBusy(false);
}

export function chain(): void {
  setLoading(true);
  search().then(() => {
    setLoading(false);
  });
}

export async function insideTry(): Promise<void> {
  try {
    setLoading(true);
    await search();
    setLoading(false);
  } catch (error) {
    report(error);
  }
}

export async function remoteData(): Promise<void> {
  setState({ status: "loading" });
  await search();
  setState({ status: "ready", data: "done" });
}

export async function otherName(): Promise<void> {
  setWaiting(true);
  await search();
  setWaiting(false);
}

export async function status(): Promise<void> {
  setStatus("saving");
  await submit();
  setStatus("saved");
}

// Without `@neverRejects` the call is followed to `fetch`, which can reject.
async function untaggedSearch(): Promise<void> {
  await search();
}

export async function untagged(): Promise<void> {
  setLoading(true);
  await untaggedSearch();
  setLoading(false);
}

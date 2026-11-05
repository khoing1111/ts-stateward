// The request rejects when the network fails: stateward follows `search` to `fetch`.
async function search(): Promise<void> {
  await fetch("/search");
}

declare function setLoading(value: boolean): void;

export async function onSearch(): Promise<void> {
  setLoading(true);
  await search();
  setLoading(false);
}

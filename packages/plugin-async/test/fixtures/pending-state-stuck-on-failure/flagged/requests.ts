// Requests that reject when the network fails: stateward follows them to `fetch`.
export async function search(): Promise<void> {
  await fetch("/search");
}

export async function submit(): Promise<{ ok: boolean }> {
  const response = await fetch("/submit", { method: "POST" });
  return { ok: response.ok };
}

export const api = {
  async fetchAll(page: number): Promise<string[]> {
    const response = await fetch(`/items?page=${String(page)}`);
    return [response.statusText];
  },
};

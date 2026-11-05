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

declare function reportError(error: unknown): void;

/** A store wrapper that catches, reports and returns null: it never rejects. */
export const store = {
  async loadItems(): Promise<string[] | null> {
    try {
      const response = await fetch("/items");
      return [response.statusText];
    } catch (error) {
      reportError(error);
      return null;
    }
  },
};

/** The same, around any request. */
export async function safely<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    reportError(error);
    return null;
  }
}

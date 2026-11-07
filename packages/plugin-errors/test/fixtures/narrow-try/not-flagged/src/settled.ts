// `Promise.allSettled` never rejects (Infisical, user trial 1.0.2): it is not what the `try` is for.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const api: any;
declare function showError(error: unknown): void;

export async function removeAll(ids: readonly string[], onDone: () => void): Promise<void> {
  try {
    await Promise.allSettled(ids.map((id) => api.remove(id)));
    onDone();
  } catch (e) {
    showError(e);
  }
}

export async function removeTwo(a: string, b: string, onDone: () => void): Promise<void> {
  try {
    const results = await Promise.allSettled([api.remove(a), api.remove(b)]);
    onDone();
    return results.length > 0 ? undefined : undefined;
  } catch (e) {
    showError(e);
  }
}

export async function settle(work: Promise<void>, onDone: () => void): Promise<void> {
  try {
    await Promise.allSettled([work]);
    onDone();
  } catch (e) {
    showError(e);
  }
}

/** Functions the `try` only defines run later: what they call is not the `try`'s request or bug. */
class TooLarge extends Error {}

function chunk(texts: readonly string[]): string[][] {
  if (texts.length > 100) throw new TooLarge("too many");
  return [texts.slice()];
}

export async function defineThenSettle(
  texts: readonly string[],
  onDone: () => void,
): Promise<void> {
  try {
    const importAll = async (): Promise<number> => {
      const chunks = chunk(texts);
      return chunks.length;
    };
    const write = async (): Promise<void> => {
      onDone();
    };
    await Promise.allSettled([importAll(), write()]);
  } catch (e) {
    showError(e);
  }
}

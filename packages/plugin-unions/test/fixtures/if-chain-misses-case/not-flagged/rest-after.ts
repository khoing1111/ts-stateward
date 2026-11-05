// Found in the production corpus (excalidraw, tldraw): the value's absent case is handled by the
// code after the chain, which runs for every case.
export function assetUrls(base: string | string[] | undefined): string[] {
  const urls: string[] = [];
  if (typeof base === "string") {
    urls.push(base);
  } else if (Array.isArray(base)) {
    urls.push(...base);
  }
  urls.push("/fallback");
  return urls;
}

export function flattened(delta: { x: number; y: number }, flatten: "x" | "y" | null): number {
  if (flatten === "x") {
    delta.x = 0;
  } else if (flatten === "y") {
    delta.y = 0;
  }
  return delta.x + delta.y;
}

// Split by shape (`typeof`, `Array.isArray`): the `else` takes the one shape left, a key of
// `State`, not 3 hidden cases (excalidraw's AppStateObserver, with 98 keys).
type State = { zoom: number; tool: string; dark: boolean };

export function selector(
  p: keyof State | (keyof State)[] | ((s: State) => unknown),
): (s: State) => unknown {
  if (typeof p === "function") {
    return p;
  } else if (Array.isArray(p)) {
    return (s) => p.map((key) => s[key]);
  } else {
    return (s) => s[p];
  }
}

/** The entries are typed `unknown`: TypeScript makes the code test each value, missing included. */
export function count(body: Record<string, unknown>): number {
  if (typeof body["count"] !== "number") return 0;
  return body["count"] + 1;
}

export function items(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body["items"])) return [];
  return body["items"].map(String);
}

export function defined(body: Record<string, unknown>): string {
  if (body["id"] === undefined) return "";
  return String(body["id"]);
}

/** A table whose entries are typed `string | undefined`: TypeScript makes the code check them. */
export function maybe(labels: Record<string, string | undefined>, k: string): string {
  return labels[k] ?? "";
}

export function maybeChecked(labels: Record<string, string | undefined>, k: string): number {
  const label = labels[k];
  return label === undefined ? 0 : label.length;
}

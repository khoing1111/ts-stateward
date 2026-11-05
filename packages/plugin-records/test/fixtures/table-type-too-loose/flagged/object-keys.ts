const names: Record<string, string> = { a: "A", b: "B" };

export const nameKeys = Object.keys(names);
export const nameValues = Object.values(names);
export const nameEntries = Object.entries(names);
export const hasA = Object.hasOwn(names, "a");

export function listNames(): string[] {
  const out: string[] = [];
  for (const key in names) out.push(key);
  return out;
}

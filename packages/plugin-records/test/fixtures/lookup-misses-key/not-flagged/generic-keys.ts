type Status = "idle" | "failed";

export function record<K extends Status>(map: Record<K, string>, key: K): string {
  return map[key];
}

export function mapped<K extends Status>(map: { [P in K]: number }, key: K): number {
  return map[key];
}

export function intersection<K extends Status>(map: Record<K, string> & { extra: string }, key: K): string {
  return map[key];
}

export function homomorphic<K extends Status>(map: Readonly<Record<K, string>>, key: K): string {
  return map[key];
}

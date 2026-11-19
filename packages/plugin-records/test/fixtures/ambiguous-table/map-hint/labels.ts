// A Map of literal pairs, only read, with a key of type `string`.
const labels = new Map<string, string>([
  ["idle", "Idle"],
  ["failed", "Failed"],
]);

export function title(status: string): string | undefined {
  return labels.get(status);
}

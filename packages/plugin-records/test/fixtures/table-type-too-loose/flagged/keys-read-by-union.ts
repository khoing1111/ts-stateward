type Level = "low" | "high";

const levels: Record<string, number> = { low: 1, high: 2 };

export function levelValue(level: Level): number {
  return levels[level];
}

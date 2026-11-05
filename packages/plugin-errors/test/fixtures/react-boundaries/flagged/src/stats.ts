export type Stats = { visits: number };

export function useStats(saved: string): Stats {
  return JSON.parse(saved);
}

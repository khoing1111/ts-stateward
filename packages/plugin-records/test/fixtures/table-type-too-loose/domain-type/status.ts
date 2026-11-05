export type TouchpointStatus = "open" | "closed";

export type FilterDictionary = Record<string, string>;

export function touchpointStatus(): TouchpointStatus {
  return "open";
}

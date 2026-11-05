import type { FilterDictionary } from "./status.js";

const pageFilters: FilterDictionary = { all: "All", mine: "Mine" };

export function pageLabel(): string {
  return pageFilters.all;
}

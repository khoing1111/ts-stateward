import type { FilterDictionary } from "./status.js";

const sortFilters: FilterDictionary = { name: "Name", date: "Date" };
const viewFilters: FilterDictionary = { grid: "Grid", list: "List" };

export function filterLabels(): string {
  return sortFilters.name + viewFilters.grid;
}

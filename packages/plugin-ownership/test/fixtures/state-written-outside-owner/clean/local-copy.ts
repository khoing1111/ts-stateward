import { items, settings } from "./settings.js";

export function themed(own: typeof settings): string {
  own.theme = "dark";
  return own.theme;
}
export function sorted(): string[] {
  const list = [...items];
  list.sort();
  return list;
}

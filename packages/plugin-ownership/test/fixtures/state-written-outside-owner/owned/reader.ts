import { count, increment, Store } from "./store.js";
import { registry } from "./mine.js";
import { setTheme, settings } from "./settings.js";

function show(value: { theme: string }): string {
  return value.theme;
}

function frozen(value: Readonly<Record<string, unknown>>): number {
  return Object.keys(value).length;
}

export function read(): string {
  setTheme("dark");
  increment();
  Store.add("z");
  const copy = { ...settings };
  copy.theme = "local";
  const clone = structuredClone(settings);
  clone.fontSize = 1;
  const tags = settings.tags.map((tag) => tag.toUpperCase());
  return [
    show(settings),
    String(frozen(settings)),
    JSON.stringify(settings),
    Object.keys(settings).join(),
    settings.theme.trim(),
    String(registry.get("a")),
    String(count),
    ...tags,
  ].join();
}

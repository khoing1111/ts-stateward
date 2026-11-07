import { settings } from "./settings.js";
import { registry } from "./mine.js";
import { Store } from "./store.js";

export function change(): void {
  settings.tags.push("x");
  registry.set("a", 1);
  Object.assign(settings, { fontSize: 2 });
  delete settings.extra;
  Store.items.push("y");
  Store.items = [];
}

import { settings } from "./settings.js";
import { registry } from "./mine.js";

type Loose = { theme: string };

export function viaCast(): void {
  (settings as Loose).theme = "x";
  (registry as unknown as Map<string, number>).delete("a");
  (registry as any).set("b", 2);
}

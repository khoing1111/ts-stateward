import { all } from "./gen.js";

export function bump(): void {
  for (const s of all()) s.count = 1;
}

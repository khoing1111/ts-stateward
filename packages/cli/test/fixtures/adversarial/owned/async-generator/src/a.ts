import { all } from "./gen.js";

export async function bump(): Promise<void> {
  for await (const s of all()) s.count = 1;
}

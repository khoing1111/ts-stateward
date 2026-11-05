import { fill } from "./not-imported.js";

export function use(): void {
  try {
    fill();
  } catch (e) {
    void e;
  }
}

import { View } from "./view.js";

export function tag(): void {
  new View().value.tags.push("t");
}

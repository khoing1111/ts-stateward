import { session } from "./session.js";

export function sortTags(): void {
  session.tags.sort();
}

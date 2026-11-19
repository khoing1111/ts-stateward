import { session } from "./session.js";

export function count(): number {
  let total = 0;
  session.tags.forEach((_tag, _index, all) => {
    total = all.length;
  });
  return total;
}

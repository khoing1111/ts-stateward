import { session } from "./session.js";

export function clear(): void {
  [session].forEach((s) => {
    s.user = null;
  });
}

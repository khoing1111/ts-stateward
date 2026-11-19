import { session } from "./session.js";

export function rename(flag: boolean, other: { user: string | null }): void {
  (flag ? session : other).user = "y";
}

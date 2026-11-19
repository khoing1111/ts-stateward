import { session } from "./session.js";

export function first(): number {
  const all = [session];
  all.push(session);
  return all[0]!.count;
}

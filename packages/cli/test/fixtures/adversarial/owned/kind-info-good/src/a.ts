import { session } from "./session.js";

export function read(): number {
  return session.count;
}

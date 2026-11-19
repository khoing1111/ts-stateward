import { session } from "./session.js";

export function* counts(): Generator<number> {
  yield session.count;
}

import { session } from "./session.js";

export function* all(): Generator<typeof session> {
  yield session;
}

import { session } from "./session.js";

export async function* counts(): AsyncGenerator<number> {
  yield session.count;
}

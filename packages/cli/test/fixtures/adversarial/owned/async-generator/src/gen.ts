import { session } from "./session.js";

export async function* all(): AsyncGenerator<typeof session> {
  yield session;
}

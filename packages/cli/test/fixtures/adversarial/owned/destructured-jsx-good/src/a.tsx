import { session } from "./session.js";

export function User() {
  const { user } = session;
  return <p>{user}</p>;
}

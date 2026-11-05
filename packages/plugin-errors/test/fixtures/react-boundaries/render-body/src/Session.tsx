import { SessionError } from "./errors";

declare function readSession(): { user: string } | undefined;

/** A throw written in the component body: a render failure. */
export function Session() {
  const session = readSession();
  if (session === undefined) throw new SessionError("signed out");
  return <p>{session.user}</p>;
}

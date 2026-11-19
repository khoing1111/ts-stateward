export class NotFoundError extends Error {}
export class AuthError extends Error {}

function auth(text: string): void {
  if (text === "") throw new AuthError("no");
}

/** @throws {NotFoundError} */
export function load(text: string): void {
  if (text === "x") throw new NotFoundError("missing");
  const check = auth;
  check(text);
}

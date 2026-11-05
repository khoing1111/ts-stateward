import { NotFoundError, ParseError, ValidationError } from "./errors.js";

function read(id: string): string {
  if (id === "") throw new NotFoundError(id);
  return id;
}

/** @throws {NotFoundError} */
export function loadUser(id: string): unknown {
  return JSON.parse(read(id));
}

/**
 * @throws {NotFoundError}
 * @throws {ValidationError} never happens
 */
export function listsTooMuch(id: string): string {
  return read(id);
}

/** @throws {never} */
export function saysNever(text: string): unknown {
  if (text === "") throw new ParseError("empty");
  return text;
}

/** @throws {NotFoundError} */
export async function fetchUser(id: string): Promise<string> {
  const response = await fetch(`/users/${id}`);
  if (!response.ok) throw new NotFoundError(id);
  return response.text();
}

/** @throws {ParseError} */
export function unclear(run: () => string): string {
  return run();
}

/** @throws {Missing} */
export function unresolved(): void {}

async function loadA(): Promise<string> {
  throw new NotFoundError("a");
}

/** @throws {ValidationError} */
export function viaThen(): Promise<number> {
  const p = loadA();
  return p.then((text) => text.length);
}

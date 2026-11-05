import { HttpError, NotFoundError } from "./errors.js";

function read(id: string): string {
  if (id === "") throw new NotFoundError(id);
  return id;
}

/** @throws {NotFoundError | SyntaxError} */
export function exact(id: string): unknown {
  return JSON.parse(read(id));
}

/** @throws {HttpError} a base class covers the classes that extend it */
export function byBase(id: string): string {
  return read(id);
}

/** @throws {never} */
export function caught(id: string): string {
  try {
    return read(id);
  } catch {
    return "";
  }
}

/** @throws {NotFoundError} */
export async function rejects(id: string): Promise<string> {
  return read(id);
}

/** @throws when the id is empty */
export function untyped(id: string): string {
  return read(id);
}

/** @throws {HttpError} */
export function partly(id: string): string {
  try {
    return read(id);
  } catch (e) {
    if (e instanceof Error && e.message === "") return "";
    throw e;
  }
}

export function undocumented(id: string): string {
  return read(id);
}

async function loadA(): Promise<string> {
  throw new NotFoundError("a");
}

async function loadB(): Promise<unknown> {
  return JSON.parse("{");
}

/** @throws {NotFoundError | SyntaxError} promises held in a const and joined */
export async function joined(): Promise<unknown[]> {
  const a = loadA();
  const b = loadB();
  return Promise.all([a, b]);
}

/** @throws {NotFoundError} a promise held in a const and returned */
export function held(): Promise<string> {
  const p = loadA();
  return p;
}

/** @throws {NotFoundError} a comparator of sort */
export function sorted(ids: string[]): string[] {
  return ids.sort((a, b) => read(a).length - read(b).length);
}

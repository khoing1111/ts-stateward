export class AErr extends Error {}

/**
 * @throws {AErr}
 * @throws {TypeError}
 */
export function put(h: Headers, name: string): void {
  if (name === "") throw new AErr("x");
  h.set(name, "1");
}

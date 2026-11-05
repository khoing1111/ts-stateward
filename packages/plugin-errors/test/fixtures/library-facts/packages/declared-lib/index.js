export class DeclaredError extends Error {}
// The source says otherwise: the declaration wins.
export function parse(text) {
  throw new RangeError(text);
}
export async function fetchIt() {
  throw new DeclaredError("no");
}

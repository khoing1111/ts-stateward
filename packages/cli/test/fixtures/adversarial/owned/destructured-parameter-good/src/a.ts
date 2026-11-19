import { session } from "./session.js";

function read({ meta }: { meta: { n: number } }): number {
  return meta.n;
}

export function run(): number {
  return read(session);
}

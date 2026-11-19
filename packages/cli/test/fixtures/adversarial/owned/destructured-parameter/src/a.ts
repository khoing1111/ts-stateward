import { session } from "./session.js";

function bump({ meta }: { meta: { n: number } }): void {
  meta.n = 3;
}

export function run(): void {
  bump(session);
}

import { session } from "./session.js";

class Keeper {
  constructor(readonly value: { count: number }) {}
}

export function keep(): Keeper {
  return new Keeper(session);
}

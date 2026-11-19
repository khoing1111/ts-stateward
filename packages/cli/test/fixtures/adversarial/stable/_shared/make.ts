import type { Actions } from "./contexts.js";

export function makeActions(): Actions {
  return { save: () => undefined };
}

export function makeHelper(onSave: (user: string) => void): () => void {
  return () => onSave("x");
}

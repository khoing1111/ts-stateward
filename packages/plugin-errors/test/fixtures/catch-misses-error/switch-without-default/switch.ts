import { store } from "./api.js";
import { AuthError } from "./errors.js";

declare function show(text: string): void;

export function switchNoDefault(kind: number): void {
  try {
    store(kind);
  } catch (e) {
    switch (true) {
      case e instanceof AuthError:
        show("who");
        break;
    }
  }
}

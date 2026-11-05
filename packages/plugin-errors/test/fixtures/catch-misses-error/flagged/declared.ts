import type { SecondError } from "./errors.js";
import { FirstError } from "./errors.js";
import { load, open } from "./external.js";

/** @throws {SecondError} */
declare function local(): void;

function show(text: string): void {
  console.log(text);
}

export function projectDeclaration(): void {
  try {
    load("a");
  } catch (e) {
    if (e instanceof FirstError) {
      show("first");
    } else {
      show("failed");
    }
  }
}

export function overloadsWithoutBody(): void {
  try {
    open("a");
  } catch (e) {
    if (e instanceof FirstError) {
      show("first");
    } else {
      show("failed");
    }
  }
}

export function declaredInThisFile(): void {
  try {
    local();
  } catch (e) {
    if (e instanceof FirstError) {
      show("first");
    } else {
      show("failed");
    }
  }
}

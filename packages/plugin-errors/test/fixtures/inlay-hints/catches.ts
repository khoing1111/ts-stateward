import { plain } from "./functions.js";
import { AuthError } from "./errors.js";

function report(error: unknown): void {
  void error;
}
declare const external: { run(): void };

export function guarded(id: string): void {
  try {
    plain(id);
    if (id === "x") throw new AuthError("log in");
  } catch (e) {
    report(e);
  }
}

export function mixedTry(): void {
  try {
    plain("a");
    external.run();
  } catch (error) {
    report(error);
  }
}

export function quiet(): void {
  try {
    external.run();
  } catch (e) {
    report(e);
  }
}

export function noVariable(): void {
  try {
    plain("a");
  } catch {
    report(null);
  }
}

export function annotatedVariable(): void {
  try {
    plain("a");
  } catch (e: unknown) {
    report(e);
  }
}

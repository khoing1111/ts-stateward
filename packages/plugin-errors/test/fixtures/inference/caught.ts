import { builtins, direct } from "./direct.js";
import { NotFoundError, ParseError } from "./errors.js";

function report(error: unknown): void {
  console.error(error);
}

export function caughtAll(id: string): string {
  try {
    return direct(id);
  } catch {
    return "";
  }
}

export function partial(id: string): unknown {
  try {
    return builtins(direct(id));
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export function rethrowAll(id: string): unknown {
  try {
    return builtins(direct(id));
  } catch (e) {
    report(e);
    throw e;
  }
}

export function wrapsIt(id: string): string {
  try {
    return direct(id);
  } catch (e) {
    throw new ParseError("bad id", { cause: e });
  }
}

export function chain(id: string): unknown {
  try {
    return builtins(direct(id));
  } catch (e) {
    if (e instanceof SyntaxError) {
      return 1;
    } else if (e instanceof NotFoundError) {
      return 2;
    } else {
      throw e;
    }
  }
}

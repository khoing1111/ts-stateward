import { parse, send, store } from "./api.js";
import { AuthError, ParseError } from "./errors.js";

function show(text: string): void {
  console.log(text);
}

export async function elseThatLogs(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
    } else if (e instanceof TypeError) {
      show("offline");
    } else {
      show("failed");
    }
  }
}

export function noElse(text: string): unknown {
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof ParseError) {
      show("empty");
    }
    return null;
  }
}

export function switchCases(kind: number): void {
  try {
    store(kind);
  } catch (e) {
    switch (true) {
      case e instanceof AuthError:
        show("who");
        break;
      default:
        show("other");
    }
  }
}

export function manyMissing(kind: number): void {
  try {
    store(kind);
    parse("x");
  } catch (e) {
    if (e instanceof ParseError) {
      show("parse");
    } else {
      show("other");
    }
  }
}

export async function directThrow(ready: boolean): Promise<void> {
  try {
    if (!ready) throw new ParseError("not ready");
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError || e instanceof TypeError) {
      show("log in");
    } else {
      show("failed");
    }
  }
}

type Button = { addEventListener(type: string, listener: () => void): void };

export function inHandler(button: Button): void {
  button.addEventListener("click", () => {
    try {
      parse("x");
    } catch (e) {
      if (e instanceof ParseError) {
        show("parse");
      } else {
        show("other");
      }
    }
  });
}

export function inCallback(texts: readonly string[]): void {
  texts.forEach((text) => {
    try {
      parse(text);
    } catch (e) {
      if (e instanceof ParseError) {
        show("parse");
      } else {
        show("other");
      }
    }
  });
}

export async function tailIgnoresError(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError) return;
    show("failed");
  }
}

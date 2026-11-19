import { AuthError, ParseError } from "./errors.js";

function show(message: string): void {
  void message;
}

function risky(kind: number): void {
  if (kind === 1) throw new ParseError("bad");
  if (kind === 2) throw new AuthError("log in");
}

export function nested(): void {
  if (Math.random() > 0.5) {
    try {
      risky(1);
    } catch (e) {
      show("failed");
      show("again");
    }
  }
}

export function multiline(): void {
  try {
    risky(1);
  } catch (e) {
    show(`failed
  twice`);
  }
}

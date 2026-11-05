import { AuthError, ParseError } from "./errors.js";

function show(message: string): void {
  void message;
}

function risky(kind: number): void {
  if (kind === 1) throw new ParseError("bad");
  if (kind === 2) throw new AuthError("log in");
}

export function wrapped(): void {
  try {
    risky(1);
  } catch (e) {
    show("failed");
  }
}

export function chain(): void {
  try {
    risky(1);
  } catch (e) {
    if (e instanceof ParseError) {
      show("parse");
    } else {
      throw e;
    }
  }
}

export function rethrows(): void {
  try {
    risky(1);
  } catch (e) {
    show("failed");
    throw e;
  }
}

export function nothingKnown(): void {
  try {
    show("fine");
  } catch (e) {
    show("failed");
  }
}

export function noVariable(): void {
  try {
    risky(1);
  } catch {
    show("failed");
  }
}

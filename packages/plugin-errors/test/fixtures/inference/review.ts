// The cases of an earlier review.
import { NotFoundError, ParseError } from "./errors.js";

export async function loadA(): Promise<string> {
  throw new NotFoundError("a");
}

export async function loadB(): Promise<string> {
  throw new ParseError("b");
}

export function parse(text: string): number {
  if (text === "") throw new ParseError("empty");
  return text.length;
}

// ---- promises held in a const ----

export async function joined(): Promise<string[]> {
  const a = loadA();
  const b = loadB();
  return Promise.all([a, b]);
}

export function returned(): Promise<string> {
  const p = loadA();
  return p;
}

export function chained(): Promise<number> {
  const p = loadA();
  return p.then((text) => text.length);
}

export function raced(): Promise<string> {
  const a = loadA();
  return Promise.race([a]);
}

export function anyOf(): Promise<string> {
  const a = loadA();
  return Promise.any([a]);
}

export function settled(): Promise<unknown> {
  const a = loadA();
  return Promise.allSettled([a]);
}

export function relayed(): Promise<string> {
  const p = loadA();
  const q = p;
  return q;
}

// ---- promises whose origin cannot be followed ----

export async function reassigned(): Promise<string> {
  let p = loadA();
  p = loadB();
  return p;
}

export function fromParameter(p: Promise<string>): Promise<string> {
  return p;
}

export function fromProperty(box: { readonly p: Promise<string> }): Promise<string> {
  return box.p;
}

// ---- callbacks of the platform ----

export function sorted(texts: string[]): string[] {
  return texts.sort((a, b) => parse(a) - parse(b));
}

export function fromList(texts: readonly string[]): number[] {
  return Array.from(texts, (text) => parse(text));
}

export function replaced(text: string): string {
  return text.replace(/a/g, (match) => String(parse(match)));
}

export function replacedByText(text: string, by: string): string {
  return text.replace(/a/g, by);
}

export function revived(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    parse(String(value));
    return value;
  });
}

export function later(): void {
  setTimeout(() => parse(""), 0);
  queueMicrotask(() => {
    parse("");
  });
}

export function observed(): MutationObserver {
  return new MutationObserver(() => parse(""));
}

export function applied(): number {
  return Reflect.apply(parse, undefined, [""]);
}

export function appliedQuiet(): number {
  return Reflect.apply((n: number) => n + 1, undefined, [1]);
}

// ---- fetch's options ----

export function passedOn(init: RequestInit): Promise<Response> {
  return fetch("/x", init);
}

export function spread(init: RequestInit): Promise<Response> {
  return fetch("/x", { ...init });
}

export function withSignal(init: { readonly signal: AbortSignal }): Promise<Response> {
  return fetch("/x", init);
}

// ---- @throws on a function that returns a promise ----

/** @throws {NotFoundError} */
export function getUser(): Promise<string> {
  return loadA();
}

// ---- a promise held at the top of the module ----

const shared = loadA();

export function fromModule(): Promise<string> {
  return shared;
}

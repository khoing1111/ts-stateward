import {
  AuthError,
  ConflictError,
  ParseError,
  QuotaError,
  RateLimitError,
} from "./errors.js";

declare const external: { run(): void };

export function plain(id: string) {
  if (id === "") throw new ParseError("empty");
  return id;
}

export function annotated(id: string): string {
  if (id === "") throw new ParseError("empty");
  return id;
}

export class Service {
  find(id: string): string {
    if (id === "") throw new AuthError("log in");
    if (id === "x") throw new ParseError("bad");
    return id;
  }
}

export const arrow = (id: string) => {
  if (id === "") throw new ParseError("empty");
  return id;
};

export async function load(id: string): Promise<string> {
  if (id === "") throw new RateLimitError("slow down");
  return id;
}

export function many(kind: number): void {
  if (kind === 1) throw new QuotaError("full");
  if (kind === 2) throw new ConflictError("taken");
  if (kind === 3) throw new RateLimitError("later");
  if (kind === 4) throw new AuthError("who");
  if (kind === 5) throw new ParseError("what");
}

export function nothing(): number {
  return 1;
}

export function unsure(): void {
  external.run();
}

export function mixed(kind: number): void {
  if (kind === 1) throw new QuotaError("full");
  external.run();
}

declare const cache: { flush(): void };

export function several(): void {
  external.run();
  cache.flush();
}

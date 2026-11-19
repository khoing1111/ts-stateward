import { AuthError, ConflictError, ParseError, QuotaError, RateLimitError } from "./errors.js";

export async function send(body: string): Promise<void> {
  const response = await fetch("/send", { method: "POST", body });
  if (response.status === 429) throw new RateLimitError("slow down");
  if (response.status === 401) throw new AuthError("log in");
}

export function parse(text: string): unknown {
  if (text === "") throw new ParseError("empty");
  return JSON.parse(text);
}

export function store(kind: number): void {
  if (kind === 1) throw new QuotaError("full");
  if (kind === 2) throw new ConflictError("taken");
  if (kind === 3) throw new RateLimitError("later");
  if (kind === 4) throw new AuthError("who");
}

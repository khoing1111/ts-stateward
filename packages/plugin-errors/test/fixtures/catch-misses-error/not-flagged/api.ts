import { AuthError, MixedError, RateLimitError, TimeoutError } from "./errors.js";

export async function send(body: string): Promise<void> {
  const response = await fetch("/send", { method: "POST", body });
  if (response.status === 408) throw new TimeoutError("slow");
  if (response.status === 401) throw new AuthError("log in");
}

export function limited(): void {
  throw new RateLimitError("later");
}

export function mixed(): void {
  throw new MixedError("mixed");
}

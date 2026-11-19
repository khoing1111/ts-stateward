import type { FallbackProps } from "react-error-boundary";
import { AuthError } from "./errors";

export function Fallback({ error }: FallbackProps) {
  if (error instanceof AuthError) return <p>Please sign in again.</p>;
  return null;
}

import type { FallbackProps } from "react-error-boundary";
import { AuthError, NotFoundError } from "./errors";

export function UserErrorPage({ error }: FallbackProps) {
  if (error instanceof NotFoundError) return <p>This user does not exist.</p>;
  if (error instanceof AuthError) return <p>Please sign in again.</p>;
  return null;
}

import type { FallbackProps } from "react-error-boundary";
import { NotFoundError } from "./errors";

export function ErrorPage({ error }: FallbackProps) {
  if (error instanceof NotFoundError) return <p>This page does not exist.</p>;
  return <p>Something went wrong: {String(error)}</p>;
}

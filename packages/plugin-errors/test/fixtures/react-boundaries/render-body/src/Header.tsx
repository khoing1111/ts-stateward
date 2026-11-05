import { useLabel } from "./label";

declare function readLabel(): string | undefined;

/** A hook whose check on its parameter fails for a value the caller can pass. */
export function Header() {
  const label = useLabel(readLabel());
  return <h1>{label}</h1>;
}

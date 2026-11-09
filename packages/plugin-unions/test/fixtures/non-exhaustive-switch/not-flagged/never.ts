/** The project's own exhaustiveness helper: plain TypeScript, no library. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

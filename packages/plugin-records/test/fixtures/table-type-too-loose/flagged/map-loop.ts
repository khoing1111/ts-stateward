const flags: Map<string, boolean> = new Map([["dark", true]]);

export function describeFlags(): string[] {
  const lines: string[] = [];
  for (const [name, on] of flags) lines.push(`${name}=${String(on)}`);
  flags.forEach((on, name) => lines.push(`${name}:${String(on)}`));
  return lines;
}

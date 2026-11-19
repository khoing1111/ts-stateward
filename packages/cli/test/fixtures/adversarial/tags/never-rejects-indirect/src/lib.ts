export async function post(): Promise<void> {
  const response = await fetch("/x");
  if (!response.ok) throw new Error("no");
}

export function report(error: unknown): void {
  console.error(error);
}

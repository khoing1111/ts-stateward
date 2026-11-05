import type { Result } from "neverthrow";

declare const input: unknown;
declare function chargeCard(amount: number): Promise<Result<string, Error>>;
declare function parseUser(
  value: unknown,
): { success: true; data: { name: string } } | { success: false; error: Error };

export async function used(): Promise<string | undefined> {
  const charged = await chargeCard(10);
  if (charged.isErr()) return undefined;
  const parsed = parseUser(input);
  return parsed.success ? parsed.data.name : charged.value;
}

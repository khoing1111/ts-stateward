import type { Result } from "neverthrow";

declare const input: unknown;
declare function chargeCard(amount: number): Promise<Result<string, Error>>;
declare function parseUser(
  value: unknown,
): { success: true; data: { name: string } } | { success: false; error: Error };

export async function dropped(): Promise<void> {
  await chargeCard(10);
  parseUser(input);
}

export type Positive = number & { readonly __brand: "Positive" };

export function positive(value: number): Positive | undefined {
  return value > 0 ? (value as Positive) : undefined;
}

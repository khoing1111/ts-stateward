let swapped: Record<string, string> = { a: "x" };

export function swap(next: Record<string, string>): void {
  swapped = next;
}

export const read = swapped.a;

// A record keyed by numbers (tldraw's `strokeWidthsToSizes`): any number looks valid, not any string.
const sizeOfWidth: Record<number, string> = { 1: "s", 2: "m", 4: "l" };

export function sizeFor(width: 1 | 2 | 4): string {
  return sizeOfWidth[width];
}

export const settings = { theme: "light", fontSize: 14, raw: {} as Record<string, unknown> };
export const items: string[] = [];
export class Cart {
  lines: number[] = [];
  add(line: number): void {
    this.lines.push(line);
  }
}
export const cart = new Cart();
export const loose: any = {};
export const total = compute();
export const LIMIT = 5;

function compute(): { n: number } {
  return { n: 1 };
}

export function setTheme(theme: string): void {
  settings.theme = theme;
  items.push(theme);
}

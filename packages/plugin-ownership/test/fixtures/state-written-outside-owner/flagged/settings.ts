export const settings = { theme: "light", fontSize: 14, raw: {} as Record<string, string> };
export const counters = { total: 0 };
export const state = { user: { name: "" } };
export const items: string[] = [];
export const registry = new Map<string, number>();
export const tags = new Set<string>();
export const cache: Record<string, number> = {};
export let current = { id: 1 };

export class Cart {
  lines: number[] = [];
  add(line: number): void {
    this.lines.push(line);
  }
}
export const cart = new Cart();

export function setTheme(theme: string): void {
  settings.theme = theme;
}

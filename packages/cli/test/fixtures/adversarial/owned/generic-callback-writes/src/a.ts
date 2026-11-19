import { settings } from "./settings.js";

function each<T>(xs: T[], f: (x: T) => void): void {
  for (const x of xs) f(x);
}

export function g(): void {
  each(settings.items, (i) => {
    i.n = 2;
  });
}

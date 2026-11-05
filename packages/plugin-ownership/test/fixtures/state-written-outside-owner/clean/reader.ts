import { cart, items, settings, setTheme } from "./settings.js";

export const label = `${settings.theme} ${String(items.length)}`;
export const copy = { ...settings };
copy.theme = "dark";
export const names = items.map((item) => item.toUpperCase());
export const merged = Object.assign({}, settings);
cart.add(1);
setTheme("dark");

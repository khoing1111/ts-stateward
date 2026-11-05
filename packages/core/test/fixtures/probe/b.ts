import { greet as hello, pick } from "./a.js";

export const first = hello("x");
export const second = pick(1);
export const third = pick(Math.random() > 0.5 ? 1 : 2);
export const fourth = hello(String(first));

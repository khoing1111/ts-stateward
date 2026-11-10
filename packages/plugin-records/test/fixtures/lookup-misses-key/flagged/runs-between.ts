// Code runs between the guard and the read: each read stays reported (an adversarial review of 1.2.1).
type Key = "idle" | "loading" | "failed";
const COUNT: Record<string, number> = { idle: 1, loading: 2 };
const ALIAS = COUNT;
export function aliasDelete(s: Key): string {
  if (COUNT[s] === undefined) return "";
  delete ALIAS[s];
  return COUNT[s].toFixed();
}
function clear(t: Record<string, number>): void { for (const k of Object.keys(t)) delete t[k]; }
export function calledClear(s: Key): string {
  if (COUNT[s] === undefined) return "";
  clear(COUNT);
  return COUNT[s].toFixed();
}
export function setUndef(s: Key): string {
  if (COUNT[s] === undefined) return "";
  COUNT[s] = undefined as never;
  return COUNT[s].toFixed();
}
let TABLE: Record<string, number> = { idle: 1 };
function reload(): void { TABLE = {}; }
export function moduleReload(s: Key): string {
  if (TABLE[s] === undefined) return "";
  reload();
  return TABLE[s].toFixed();
}
let current: Key = "idle";
function advance(): void { current = "failed"; }
export function moduleKey(): string {
  if (COUNT[current] === undefined) return "";
  advance();
  return COUNT[current].toFixed();
}
export class Store {
  labels: Record<string, string> = { idle: "I" };
  reset(): void { this.labels = {}; }
  label(s: Key): string {
    if (this.labels[s] === undefined) return "";
    this.reset();
    return this.labels[s].toUpperCase();
  }
}
export function reflectDelete(s: Key): string {
  if (COUNT[s] === undefined) return "";
  Reflect.deleteProperty(COUNT, s);
  return COUNT[s].toFixed(); // L46
}
export async function awaited(s: Key): Promise<string> {
  if (TABLE[s] === undefined) return "";
  await Promise.resolve();
  return TABLE[s].toFixed();
}
function load(): Record<string, number> { return Math.random() > 0.5 ? { idle: 1 } : {}; }
export function callTable(s: Key): string {
  if (load()[s] === undefined) return "";
  return load()[s].toFixed();
}
export function control(s: Key): string {
  if (COUNT[s] === undefined) return "";
  return COUNT[s].toFixed();
}
export function tryFinally(s: Key): string {
  try {
    if (COUNT[s] === undefined) return "";
  } finally {
    delete COUNT[s];
  }
  return COUNT[s].toFixed(); // L68
}

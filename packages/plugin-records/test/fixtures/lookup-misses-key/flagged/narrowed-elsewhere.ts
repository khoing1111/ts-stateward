/** No guard narrowed this read: a guard on another key, or none at all. */
export function otherKey(body: Record<string, string | number>): string | number {
  if (typeof body["total"] !== "number") return 0;
  return body["count"];
}

export function notNarrowed(body: Record<string, string | number>): string | number {
  return body["count"];
}

const ENABLED: Record<string, boolean> = { idle: true, loading: false };

/** `!== false` narrows the type but lets a missing key through: `undefined.toString()`. */
export function enabledLabel(status: "idle" | "loading" | "failed"): string {
  if (ENABLED[status] !== false) return ENABLED[status].toString();
  return "off";
}

const LIMITS: Record<string, number | "none"> = { idle: 1, loading: 2 };

/** `!== "none"` leaves `undefined` possible: `undefined.toFixed()`. */
export function limit(status: "idle" | "loading" | "failed"): string {
  if (LIMITS[status] !== "none") return LIMITS[status].toFixed(0);
  return "";
}

const COUNT: Record<string, number> = { idle: 1, loading: 2 };

/** The guard tests the parameter `s`; the loop reads its own `s`. */
export function shadowLoop(s: "idle" | "loading" | "failed", list: ("idle" | "failed")[]): number {
  if (COUNT[s] === undefined) return 0;
  let total = 0;
  for (const s of list) total += COUNT[s].valueOf();
  return total;
}

/** The key changes after the guard, before the next turn of the loop reads it. */
export function loopNext(list: ("idle" | "failed")[]): number {
  let s = list[0] ?? "idle";
  for (let i = 0; i < 3; i++) {
    if (COUNT[s] === undefined) return 0;
    s = list[i + 1] ?? "failed";
    console.log(COUNT[s].toFixed());
  }
  return 0;
}

type Key = "idle" | "loading" | "failed";

/** Each of these writes the key after the guard, so the read is not covered. */
export function destructured(first: Key, next: { s: Key }): string {
  let s: Key = first;
  if (COUNT[s] === undefined) return "";
  ({ s } = next);
  return COUNT[s].toFixed();
}

export function fromList(first: Key, next: [Key]): string {
  let s: Key = first;
  if (COUNT[s] === undefined) return "";
  [s] = next;
  return COUNT[s].toFixed();
}

export function outerLoop(first: Key, list: Key[]): string {
  let s: Key = first;
  if (COUNT[s] === undefined) return "";
  for (s of list) console.log(s);
  return COUNT[s].toFixed();
}

export function byClosure(first: Key): string {
  let s: Key = first;
  const reset = (): void => {
    s = "failed";
  };
  if (COUNT[s] === undefined) return "";
  reset();
  return COUNT[s].toFixed();
}

export function propertyKey(o: { k: Key }, other: Key): string {
  if (COUNT[o.k] === undefined) return "";
  o.k = other;
  return COUNT[o.k].toFixed();
}

export function assigned(o: { k: Key }, other: Key): string {
  if (COUNT[o.k] === undefined) return "";
  Object.assign(o, { k: other });
  return COUNT[o.k].toFixed();
}

const COUNTED: Record<string, number> = { idle: 1 };

/** A key read from an object: another name for it can change it, so the guard is not trusted. */
export function propertyKeyKept(o: { k: "idle" | "failed" }): string {
  if (COUNTED[o.k] === undefined) return "";
  return COUNTED[o.k].toFixed();
}

/** A key read from an array: `ids[0] = other` can change `ids[i]`. */
export function elementKey(ids: Key[], i: number, other: Key): string {
  if (COUNT[ids[i] ?? "idle"] === undefined) return "";
  ids[0] = other;
  return COUNT[ids[i] ?? "idle"].toFixed();
}

/** The entry is deleted after the guard. */
export function deleted(s: Key): string {
  if (COUNT[s] === undefined) return "";
  delete COUNT[s];
  return COUNT[s].toFixed();
}

// Each value below leaves the file in a way the rule cannot follow, so it says nothing.
const toMutable: Record<string, string> = { a: "x" };
const returned: Record<string, string> = { a: "x" };
const assigned: Record<string, string> = { a: "x" };
const inArray: Record<string, string> = { a: "x" };
const inObject: Record<string, string> = { a: "x" };
const shorthand: Record<string, string> = { a: "x" };
const destructured: Record<string, string> = { a: "x" };
const stringified: Record<string, string> = { a: "x" };
const defaulted: Record<string, string> = { a: "x" };
const wrapped: Record<string, string> = { a: "x" };
const mapReturned = new Map<string, number>([["a", 1]]);
const mapSpread = new Map<string, number>([["a", 1]]);

function fill(target: Record<string, string>): void {
  target.extra = "y";
}

export function mutate(): void {
  fill(toMutable);
}

export function getReturned(): Record<string, string> {
  return returned;
}

export const another = assigned;
export const list = [inArray];
export const holder = { value: inObject };
export const short = { shorthand };
export const { a: firstA } = destructured;
export const json = JSON.stringify(stringified);
export default defaulted;
export const asOther = wrapped as Record<string, unknown>;
export const wrapOther = [wrapped];

export function getMap(): Map<string, number> {
  return mapReturned;
}

export const entries = [...mapSpread];

type Status = "idle" | "failed" | "done";

declare const status: Status;
declare const text: string;
declare const index: 0 | 1;

const complete: Record<Status, string> = { idle: "a", failed: "b", done: "c" };
const checked = { idle: "a", failed: "b", done: "c" } satisfies Record<Status, string>;
const optional: Partial<Record<Status, string>> = {};
const orUndefined: Record<string, string | undefined> = {};
const open: Record<string, string> = {};
const counts: Record<string, number> = {};
const list: string[] = [];
const tuple: [string, string] = ["a", "b"];
const either: Record<Status, string> | Record<string, string> = complete;
const withOptional: { idle: string; failed?: string; done?: string } = { idle: "a" };

export const full = complete[status];
export const satisfied = checked[status];
export const optionalKeys = optional[status];
export const undefinedValues = orUndefined[status];
export const withOptionalKeys = withOptional[status];
export const notFinite = open[text];
export const array = list[index];
export const fixed = tuple[index];
export const characters = text[index];
export const present = complete["idle"];
export const union = either[status];

export function read(): void {
  open[status] = "x";
  open[status] += "y";
  [open[status]] = ["z"];
  ({ a: open[status] } = { a: "w" });
  delete open[status];
  for (open[status] of ["a"]) void 0;
  counts[status]++;
}

export const handled = [
  open[status]?.length,
  open[status] ?? "none",
  open[status] || "none",
  open[status] === undefined,
  undefined !== open[status],
  open[status] == null,
  typeof open[status],
  open[status]!,
  !open[status],
  open[status] ? 1 : 2,
  open[status] && 1,
  (open[status])?.length,
];

export function branch(): number {
  if (open[status]) return 1;
  while (open[status]) return 2;
  return 0;
}

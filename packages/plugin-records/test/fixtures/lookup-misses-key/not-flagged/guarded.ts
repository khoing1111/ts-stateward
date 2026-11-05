type Status = "idle" | "failed";

declare const status: Status;
declare const other: Status;
const labels: Record<string, string> = { idle: "Idle" };
const others: Record<string, string> = { idle: "Idle" };

export function inCheck(s: Status): string {
  if (s in labels) {
    return labels[s];
  }
  return "";
}

export function hasOwnCall(s: Status): string {
  if (Object.hasOwn(labels, s)) return labels[s];
  return "";
}

export function hasOwnProperty(s: Status): string {
  if (labels.hasOwnProperty(s)) return labels[s];
  return "";
}

export function throughPrototype(s: Status): string {
  return Object.prototype.hasOwnProperty.call(labels, s) ? labels[s] : "";
}

export const ternary = status in labels ? labels[status] : "";
export const both = Object.hasOwn(labels, status) && labels[status].length;
export const spaced = (status in labels) && labels[ status ];
export const conjunction = other === "idle" && status in labels && labels[status].length;

export function elseOfNegation(s: Status): string {
  if (!(s in labels)) {
    return "";
  } else {
    return labels[s];
  }
}

export function insideCallback(s: Status): string[] {
  if (s in labels) return ["a"].map(() => labels[s] ?? "");
  return [];
}

export function nested(s: Status, t: Status): string {
  if (s in labels) {
    if (t in others) return labels[s] + others[t];
  }
  return "";
}

import type { OpenUnion } from "./guarantees.js";

/** The server adds kinds before this app knows them. */
export type Part = OpenUnion<
  { kind: "text"; text: string } | { kind: "image"; url: string } | { kind: string; payload: unknown }
>;

// Every kind it knows is listed, no `default`: a kind the server adds goes nowhere.
export function noDefault(part: Part): string {
  switch (part.kind) {
    case "text":
      return "text";
    case "image":
      return "image";
  }
  return "";
}

// A `default` handles the kinds the union does not list: correct.
export function withDefault(part: Part): string {
  switch (part.kind) {
    case "text":
      return "text";
    default:
      return "other";
  }
}

// A union that is not stated open keeps its rules: a plain object is not asked for a `default`.
type Plain = { kind: "a" } | { kind: "b" };
export function plain(value: Plain): string {
  switch (value.kind) {
    case "a":
      return "a";
    case "b":
      return "b";
  }
}

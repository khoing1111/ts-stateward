export type Literals = { kind: "a"; id: number } | { kind: "b"; raw: unknown };

export type AllOpen = { kind: string; id: number } | { kind: string; raw: unknown };

export type OtherBase = { kind: "a" } | { kind: number };

export type OneMember = { kind: string };

export type OnlyOne = { kind: "a"; id: number } | { raw: unknown; extra: string };

export type Optional = { kind: "a" } | { kind?: undefined };

type Open = { kind: string; raw: unknown };

// Members written by name are not inspected.
export type ByName = { kind: "a" } | Open;

export type Combined = { kind: "a" } & { other: string };

export type Plain = string | number;

export type Computed = { [key: string]: string } | { kind: "a" };

export interface Contract {
  kind: string;
}

export type Function = (kind: string) => void;

// `kind` already tells every member apart, and no code narrows on `depth`.
export type ShapedRow = { kind: "root"; depth: 0 } | { kind: "child"; depth: number };

export function indent(row: ShapedRow): number {
  return row.kind === "root" ? 0 : row.depth * 2;
}

// A boolean tag tells the members apart too.
export type Loaded = { ok: true; count: 1 } | { ok: false; count: number };

// `depth === 0` only compares a value; `turn`, read after it, is on every
// member, so nothing relies on the test picking a member.
export type TurnRow =
  | { kind: "user"; depth: 0; turn: number; text: string }
  | { kind: "tool"; depth: number; turn: number; call: string };

export function startsTurn(row: TurnRow): boolean {
  return row.depth === 0 && row.turn > 0;
}

export function firstTurn(row: TurnRow): number {
  const { depth, turn } = row;
  if (depth !== 0) return -1;
  return turn;
}

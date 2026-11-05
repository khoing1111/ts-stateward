export type Event = { kind: "a"; id: number } | { kind: string; raw: unknown };

export type Reading = { level: 1; ok: true } | { level: number };

export type Shape = { tag: "x" | "y" } | { tag: string };

export type Both = { a: "x"; b: 1 } | { a: string; b: number };

export type Quoted = { kind: 'one' } | { kind: 'other' } | { kind: string };

export type Msg<T> =
  | { type: "data"; payload: T }
  | { type: "error"; reason: string }
  | ({ type: string });

export type Neg = { delta: -1 } | { delta: number };

export type Later = { kind: string } | { kind: "last" };

function local(): void {
  type Inner = { kind: "in" } | { kind: string };
  const value: Inner | undefined = undefined;
  void value;
}
local();

// `kind` tells the members apart, but the code narrows on `depth`: after `depth === 0` it reads
// `title`, which only the root has, though the test keeps both members.
export type ShapedNarrowed =
  | { kind: "root"; depth: 0; title: string }
  | { kind: "child"; depth: number; parentId: string };

export type ShapedLevel =
  | { kind: "root"; level: 0; title: string }
  | { kind: "child"; level: number; parentId: string };

// the cast relies on `depth === 0` picking the turn member.
export type ShapedTurn =
  | { kind: "run"; depth: number; runId: string }
  | { kind: "turn"; depth: 0; turn: number };

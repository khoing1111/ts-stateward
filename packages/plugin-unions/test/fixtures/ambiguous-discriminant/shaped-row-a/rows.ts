// `turn` is only on the turn member. `kind` tells the members
// apart, and every read of a member-only property below is narrowed by `kind`, which TypeScript
// checks; the `depth` tests only compare a value.
export type ShapedRow =
  | { kind: "run"; depth: number; runId: string }
  | { kind: "group"; depth: number; children: number }
  | { kind: "turn"; depth: 0; turn: number };

export function rowKey(row: ShapedRow): string {
  if (row.depth === 0 && row.kind === "turn") return `turn-${row.turn}`;
  if (row.kind === "run") return `run-${row.runId}`;
  return `row-${row.depth}`;
}

export function indent(row: ShapedRow): number {
  if (row.depth === 0) return 0;
  if (row.kind === "group") return row.children > 0 ? row.depth * 2 : row.depth;
  return row.depth * 2;
}

export function label(row: ShapedRow): string {
  switch (row.depth) {
    case 0:
      return row.kind === "turn" ? `Turn ${row.turn}` : "top";
    default:
      return "nested";
  }
}

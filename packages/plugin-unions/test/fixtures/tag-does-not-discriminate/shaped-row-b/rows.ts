// `turn` is on every member (optional on the others), so reading
// it after `row.depth === 0` does not rely on the test picking the turn member.
export type ShapedRow =
  | { kind: "run"; depth: number; runId: string; turn?: number }
  | { kind: "group"; depth: number; children: number; turn?: number }
  | { kind: "turn"; depth: 0; turn: number };

export function turnOf(row: ShapedRow): number {
  if (row.depth === 0) return row.turn ?? 0;
  if (row.kind === "run") return row.runId.length;
  return -1;
}

export function startsTurn(row: ShapedRow): boolean {
  return row.depth === 0 && row.turn !== undefined;
}

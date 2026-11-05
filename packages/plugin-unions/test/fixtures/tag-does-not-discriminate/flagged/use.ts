import type { ShapedLevel, ShapedNarrowed, ShapedTurn } from "./events.js";

type Root = Extract<ShapedNarrowed, { kind: "root" }>;

export function titleOf(row: ShapedNarrowed): string {
  return row.depth === 0 ? (row as Root).title : "";
}

export function label(row: ShapedLevel): string {
  const { level } = row;
  switch (level) {
    case 0:
      return (row as Extract<ShapedLevel, { kind: "root" }>).title;
    default:
      return "child";
  }
}

type TurnMember = Extract<ShapedTurn, { kind: "turn" }>;

export function turnOf(row: ShapedTurn): number {
  if (row.depth !== 0) return -1;
  return (row as TurnMember).turn;
}

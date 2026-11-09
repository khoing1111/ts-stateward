// TypeScript leaves `undefined` in `o?.kind` in the default even after `case undefined`, so
// neither `o` nor `o?.kind` can be proven `never` there: no proof compiles, and none is asked for.
export function noProofPossible(o: { kind: "a" | "b" } | undefined): number {
  switch (o?.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    case undefined:
      return 3;
    default:
      return 0;
  }
}

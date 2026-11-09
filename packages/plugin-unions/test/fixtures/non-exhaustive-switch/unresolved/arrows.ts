// real-world corpus (tldraw): the project's never helper comes from a package whose types are not built,
// so its parameter type is unknown. The `default` may well be a complete check: an unknown, not a
// problem that names correct code.
import { exhaustiveSwitchError } from "@missing/utils";

type Info = { type: "straight"; length: number } | { type: "elbow"; turns: number };

export function describeArrow(info: Info): string {
  switch (info.type) {
    case "straight":
      return `${String(info.length)}px`;
    case "elbow":
      return `${String(info.turns)} turns`;
    default:
      exhaustiveSwitchError(info, "type");
  }
}

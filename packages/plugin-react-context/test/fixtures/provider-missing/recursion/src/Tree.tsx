import { Profile } from "./Profile";
import { Node } from "./Node";

export function Tree({ depth }: { depth: number }) {
  return depth > 0 ? <Node depth={depth - 1} /> : <Profile />;
}

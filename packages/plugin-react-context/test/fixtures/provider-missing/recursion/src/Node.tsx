import { Tree } from "./Tree";

export function Node({ depth }: { depth: number }) {
  return <Tree depth={depth} />;
}

// TypeScript narrows the object by its tag, so the check names `node`.
type NodeBase = { id: string };
type LayoutNode =
  | (NodeBase & { type: "frame"; children: string[] })
  | (NodeBase & { type: "text"; text: string });

export function nodeLabel(node: LayoutNode): string {
  if (node.type === "frame") {
    return "Frame";
  } else if (node.type === "text") {
    return node.text;
  } else {
    return "";
  }
}

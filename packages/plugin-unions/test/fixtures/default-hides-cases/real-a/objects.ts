// a tag switch over a union of objects. TypeScript narrows the object
// itself, so the check must name `node`, not `node.type`, which no longer compiles there.
type NodeBase = { id: string };
export type LayoutNode =
  | (NodeBase & { type: "frame"; children: string[] })
  | (NodeBase & { type: "text"; text: string })
  | (NodeBase & { type: "image"; src: string });

export function nodeLabel(node: LayoutNode): string {
  switch (node.type) {
    case "frame":
      return `${String(node.children.length)} children`;
    case "text":
      return node.text;
    case "image":
      return node.src;
    default:
      return "";
  }
}

// One member's tag is itself a union: TypeScript still narrows `shape` by it.
type Shape = { kind: "rect" | "ellipse"; width: number } | { kind: "line"; length: number };

export function shapeSize(shape: Shape): number {
  switch (shape.kind) {
    case "rect":
      return shape.width;
    case "ellipse":
      return shape.width / 2;
    default:
      return 0;
  }
}

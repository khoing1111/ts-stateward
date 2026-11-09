type Status = "draft" | "sent";
type Shape = { id: string };
type Info = { handle: { id: string } };
type Editor = { name: string };

function getArrowBindings(editor: Editor, shape: Shape): Record<Status, string> {
  return { draft: editor.name, sent: shape.id };
}

export function bound(editor: Editor, info: Info, shape: Shape): string {
  return getArrowBindings(editor, shape)[info.handle.id as Status];
}

const TABLES = { main: { draft: "Draft", sent: "Sent" } };

export function nested(kind: "main", status: string): string {
  return TABLES[kind][status as Status];
}

export function isBound(editor: Editor, key: string): key is Status {
  return key in getArrowBindings(editor, { id: "" });
}

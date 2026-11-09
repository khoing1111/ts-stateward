// `type satisfies never;` starts a type alias, so the check is written
// `void (type satisfies never);`.
type FieldType = "text" | "number" | "date";

export function fieldWidth(type: FieldType): number {
  switch (type) {
    case "text":
      return 200;
    case "number":
      return 80;
    case "date":
      return 120;
    default:
      return 100;
  }
}

export function fieldIcon(type: FieldType): string {
  switch (type) {
    case "text":
      return "T";
    default:
      return "#";
  }
}

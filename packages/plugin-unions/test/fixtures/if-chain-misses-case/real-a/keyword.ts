// a value named `type` is checked with `void (type satisfies never);`.
type FieldType = "text" | "number" | "date";

export function fieldWidth(type: FieldType): number {
  if (type === "text") {
    return 200;
  } else if (type === "number") {
    return 80;
  } else if (type === "date") {
    return 120;
  } else {
    return 100;
  }
}

export function checked(type: FieldType): number {
  if (type === "text") {
    return 200;
  } else if (type === "number") {
    return 80;
  } else if (type === "date") {
    return 120;
  } else {
    void (type satisfies never);
    return 100;
  }
}

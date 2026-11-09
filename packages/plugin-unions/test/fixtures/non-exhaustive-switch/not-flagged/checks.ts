// the parenthesised forms of the check count, so a subject named `type`
// can be checked without starting a type alias.
type FieldType = "text" | "number";

export function parenthesised(type: FieldType): number {
  switch (type) {
    case "text":
      return 1;
    case "number":
      return 2;
    default:
      (type) satisfies never;
      return 0;
  }
}

export function voided(type: FieldType): number {
  switch (type) {
    case "text":
      return 1;
    case "number":
      return 2;
    default:
      void (type satisfies never);
      return 0;
  }
}

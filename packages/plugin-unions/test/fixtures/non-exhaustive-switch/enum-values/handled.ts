// A string enum matched with the plain values of its members: TypeScript does not
// narrow the enum by them, but at run time every member is handled.
export enum StakeholderTypes {
  ORGANIZATION = "org",
  PERSON = "person",
}

export function log(type: StakeholderTypes): void {
  switch (type) {
    case "person":
      console.log("p");
      break;
    case "org":
      console.log("o");
      break;
  }
}

/** Every member listed by value and a `default` that throws: the `default` hides no member. */
export function name(type: StakeholderTypes): string {
  switch (type) {
    case "person":
      return "Person";
    case "org":
      return "Organization";
    default:
      throw new Error(`Unknown type: ${String(type)}`);
  }
}

export function both(type: StakeholderTypes): string {
  switch (type) {
    case StakeholderTypes.PERSON:
      return "Person";
    case "org":
      return "Organization";
    default:
      throw new Error(`Unknown type: ${String(type)}`);
  }
}

export enum Priority {
  Low = 1,
  High = 2,
}

export function rank(priority: Priority): void {
  switch (priority) {
    case 1:
      console.log("low");
      break;
    case 2:
      console.log("high");
      break;
  }
}

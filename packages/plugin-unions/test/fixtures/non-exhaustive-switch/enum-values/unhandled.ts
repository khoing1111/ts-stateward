export enum StakeholderTypes {
  ORGANIZATION = "org",
  PERSON = "person",
}

// One member left out.
export function log(type: StakeholderTypes): void {
  switch (type) {
    case "person":
      console.log("p");
      break;
  }
}

// A value that is no member's: the member it was meant for is still missing.
export function typo(type: StakeholderTypes): void {
  switch (type) {
    case "persons":
      console.log("p");
      break;
    case "org":
      console.log("o");
      break;
  }
}

// The same with a `default`: the member it handles is hidden.
export function hidden(type: StakeholderTypes): string {
  switch (type) {
    case "org":
      return "Organization";
    default:
      return "Other";
  }
}

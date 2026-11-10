import type { Role } from "./roles.js";

/** Only the type is imported: there is no value to write, so the hint says to import it. */
export function typeOnly(role: Role): string {
  switch (role) {
    case "admin":
      return "A";
    case "user":
      return "U";
  }
}

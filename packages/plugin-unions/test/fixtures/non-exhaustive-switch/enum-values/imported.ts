import { Role as R } from "./roles.js";

/** The enum is reached as `R` here: the hint and the fix say `R.Admin`. */
export function aliased(role: R): string {
  switch (role) {
    case "admin":
      return "A";
    case "user":
      return "U";
  }
}

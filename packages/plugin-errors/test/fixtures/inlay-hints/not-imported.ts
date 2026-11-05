import { QuotaError } from "./errors.js";

export function fill(): void {
  throw new QuotaError("full");
}

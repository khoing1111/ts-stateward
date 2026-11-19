import { api } from "./api.js";

export function rename(): void {
  api.current().count = 1;
}

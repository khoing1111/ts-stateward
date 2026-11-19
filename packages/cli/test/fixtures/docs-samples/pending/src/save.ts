import type { Pending } from "./guarantees";

declare function post(): Promise<void>;

export class Form {
  status: Pending<"idle" | "saving" | "saved" | "failed", "saving"> = "idle";

  async save(): Promise<void> {
    this.status = "saving";
    await post();
    this.status = "saved";
  }
}

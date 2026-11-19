import type { Pending } from "./guarantees.js";

declare function post(body: string): Promise<void>;

export class Editor {
  status: Pending<"idle" | "saving" | "saved", "saving"> = "idle";

  async save(body: string): Promise<void> {
    this.status = "saving";
    try {
      await post(body);
    } finally {
      this.status = "idle";
    }
  }
}

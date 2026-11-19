import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;
declare function sql(s: TemplateStringsArray): string;

export class S {
  saving: Pending<boolean> = false;
  q = "";

  run(): void {
    this.saving = true;
    try {
      this.q = sql`select 1`;
    } finally {
      this.saving = false;
    }
  }
}

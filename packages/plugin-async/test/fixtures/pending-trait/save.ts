import type { Pending } from "./guarantees.js";
import { useState } from "./react.js";

declare function post(body: string): Promise<void>;

type Status = "idle" | "saving" | "saved" | "failed";

export function useSave() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  // Any failed `await` leaves it running, and a second call starts while it runs.
  async function save(body: string): Promise<void> {
    setSaving(true);
    await post(body);
    setSaving(false);
  }
  return { saving, save };
}

export class Editor {
  status: Pending<Status, "saving"> = "idle";

  async save(body: string): Promise<void> {
    if (this.status === "saving") return;
    this.status = "saving";
    await post(body);
    this.status = "saved";
  }
}

export function useStart() {
  const [busy, setBusy] = useState<Pending<boolean>>(false);
  function start(): void {
    setBusy(true);
  }
  return { busy, start };
}

export function useUnnamed() {
  const [status, setStatus] = useState<Pending<Status>>("idle");
  return { status, setStatus };
}

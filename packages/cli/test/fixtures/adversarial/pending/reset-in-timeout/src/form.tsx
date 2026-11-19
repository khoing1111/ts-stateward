import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post, register } from "./api.js";

export function Form(): ReactNode {
  const [busy, setBusy] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    setBusy(true);
    await post();
    setTimeout(() => setBusy(false), 100);
  }

  return (
    <button disabled={busy} onClick={() => void save()}>
      save
    </button>
  );
}

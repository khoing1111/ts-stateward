import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post, register } from "./api.js";

export function Form(): ReactNode {
  const [busy, setBusy] = useState<Pending<boolean>>(false);
  const set = setBusy;
  async function save(): Promise<void> {
    set(true);
    try {
      await post();
    } finally {
      set(false);
    }
  }

  return (
    <button disabled={busy} onClick={() => void save()}>
      save
    </button>
  );
}

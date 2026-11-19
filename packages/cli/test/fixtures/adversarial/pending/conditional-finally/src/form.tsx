import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post, register } from "./api.js";

export function Form(): ReactNode {
  const [busy, setBusy] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    setBusy(true);
    try {
      await post();
    } finally {
      if (Math.random() > 0.5) setBusy(false);
    }
  }

  return (
    <button disabled={busy} onClick={() => void save()}>
      save
    </button>
  );
}

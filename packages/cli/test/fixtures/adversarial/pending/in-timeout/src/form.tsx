import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post, register } from "./api.js";

export function Form(): ReactNode {
  const [busy, setBusy] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    setTimeout(() => setBusy(true), 0);
    try {
      await post();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button disabled={busy} onClick={() => void save()}>
      save
    </button>
  );
}

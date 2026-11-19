import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post, register } from "./api.js";

export function useForm() {
  const [busy, setBusy] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    setBusy(true);
    try {
      await post();
    } finally {
      setBusy(false);
    }
  }
  return { busy, save };
}

export function Form(): ReactNode {
  const { busy, save } = useForm();
  return (
    <button disabled={busy} onClick={() => void save()}>
      save
    </button>
  );
}

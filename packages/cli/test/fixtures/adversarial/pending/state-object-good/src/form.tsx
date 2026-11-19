import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

export function Editor(): ReactNode {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  const [name] = useState("");
  async function save(): Promise<void> {
    setSaving(true);
    try {
      await post();
    } finally {
      setSaving(false);
    }
  }

  return (
    <button disabled={saving} onClick={() => void save()}>
      save {name}
    </button>
  );
}

import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";

async function* lines(): AsyncGenerator<string> {
  const response = await fetch("/lines");
  yield await response.text();
}

export function Form(): ReactNode {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    for await (const line of lines()) void line;
    setSaving(false);
  }
  return (
    <button disabled={saving} onClick={() => void save()}>
      save
    </button>
  );
}

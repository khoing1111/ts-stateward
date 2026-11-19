import { useState } from "react";
import type { Pending } from "./guarantees.js";

declare function post(): Promise<void>;

export function useSave() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      await post();
    } finally {
      setSaving(false);
    }
  }
  return { saving, save };
}

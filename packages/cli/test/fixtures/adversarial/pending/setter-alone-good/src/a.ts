import { useState } from "react";
import type { Pending } from "./guarantees.js";

export function useSave(): () => Promise<void> {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  return async () => {
    if (saving) return;
    setSaving(true);
    try {
      await fetch("/save");
    } finally {
      setSaving(false);
    }
  };
}

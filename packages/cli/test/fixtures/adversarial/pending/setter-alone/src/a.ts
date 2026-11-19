import { useState } from "react";
import type { Pending } from "./guarantees.js";

export function useSave(): () => Promise<void> {
  const [, setSaving] = useState<Pending<boolean>>(false);
  return async () => {
    setSaving(true);
    await fetch("/save");
    setSaving(false);
  };
}

import type { Pending } from "./guarantees.js";
import { useState } from "./react.js";

declare function post(body: string): Promise<void>;

export function useGuarded() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  const savingRef = { current: false };
  async function save(body: string): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await post(body);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }
  return { saving, save };
}

export function useSync() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  function toggle(): void {
    setSaving(true);
    setSaving(false);
  }
  return { saving, toggle };
}

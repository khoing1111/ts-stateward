import { useState } from "react";
import type { Pending } from "./guarantees.js";

declare function post(): Promise<void>;

export function useSave() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    setSaving(true);
    await post();
    setSaving(false);
  }
  return { saving, save };
}

import { useState } from "react";
import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export function Form() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  async function save(): Promise<void> {
    setSaving(true);
    try {
      await post();
    } finally {
      setSaving(false);
    }
  }
  return (
    <div>
      <button disabled={saving} onClick={() => void save()}>
        Save
      </button>
      <button>Cancel</button>
    </div>
  );
}

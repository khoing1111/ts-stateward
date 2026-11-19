import { useState } from "react";
import type { Pending } from "./guarantees.js";

export function SaveButton() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await fetch("/save");
    } finally {
      setSaving(false);
    }
  };
  return <button disabled={saving} onClick={() => void save()} />;
}

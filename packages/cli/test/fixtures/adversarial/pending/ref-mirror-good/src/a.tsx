import { useRef, useState } from "react";
import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export function Form() {
  const [saving, setSaving] = useState<Pending<boolean>>(false);
  const inFlight = useRef(false);
  async function save(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await post();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return <button onClick={() => void save()}>{saving ? "…" : "Save"}</button>;
}

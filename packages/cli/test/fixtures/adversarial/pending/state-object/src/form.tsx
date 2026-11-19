import { useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

type Form = { saving: Pending<boolean>; name: string };

export function Editor(): ReactNode {
  const [form, setForm] = useState<Form>({ saving: false, name: "" });
  async function save(): Promise<void> {
    if (form.saving) return;
    setForm({ ...form, saving: true });
    await post();
    setForm({ ...form, saving: false });
  }

  return (
    <button disabled={form.saving} onClick={() => void save()}>
      save
    </button>
  );
}

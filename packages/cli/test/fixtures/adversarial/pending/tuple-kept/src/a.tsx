import { useState } from "react";
import type { Pending } from "./guarantees.js";

export function SaveButton() {
  const saving = useState<Pending<boolean>>(false);
  const save = async () => {
    saving[1](true);
    await fetch("/save");
    saving[1](false);
  };
  return <button disabled={saving[0]} onClick={() => void save()} />;
}

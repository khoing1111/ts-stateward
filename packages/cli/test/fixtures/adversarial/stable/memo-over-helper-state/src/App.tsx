import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
declare function post(): Promise<void>;

export function App({ children }: { children: ReactNode }) {
  const [saving, setSaving] = useState(false);
  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    await post();
    setSaving(false);
  }
  const value = useMemo(() => ({ save: () => void save() }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

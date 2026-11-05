import { saveUser, toast, useDeletePlanMutation, useSaveSettingsMutation } from "./api.js";
import type { Result, Settings } from "./api.js";

declare function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T };
declare function refreshList(): Promise<void>;
// react-query's `mutateAsync` rejects on failure: a plain promise, no `unwrap()`.
declare function mutateAsync(id: string): Promise<void>;

export function useCleanForms(id: string, setOpen: (open: boolean) => void) {
  const [deletePlan] = useDeletePlanMutation();
  const [saveSettings] = useSaveSettingsMutation();

  async function unwrapped(): Promise<void> {
    try {
      await deletePlan(id).unwrap();
      toast.success("Deleted");
    } catch {
      toast.error("Could not delete");
    }
  }

  function fireAndForget(): void {
    void deletePlan(id);
  }

  async function narrowed(values: Settings): Promise<void> {
    const result = await saveSettings(values);
    if ("error" in result) {
      toast.error("Could not save");
      return;
    }
    toast.success("Saved");
  }

  async function earlyReturn(values: Settings): Promise<void> {
    const result = await saveSettings(values);
    if (result.error) return;
    toast.success(`Saved ${result.data.theme}`);
  }

  async function destructured(values: Settings): Promise<void> {
    const { data, error } = await saveSettings(values);
    if (error !== undefined) throw new Error("Could not save");
    toast.success(`Saved ${data?.theme ?? ""}`);
  }

  async function guarded(name: string): Promise<void> {
    const saved = await saveUser(name);
    if (!isOk(saved)) return;
    setOpen(false);
  }

  async function bothPaths(values: Settings): Promise<void> {
    const result = await saveSettings(values);
    if (result.error) toast.error("Could not save");
    else toast.success("Saved");
    setOpen(false);
  }

  async function passedOn(values: Settings) {
    const result = await saveSettings(values);
    return result;
  }

  async function rejects(): Promise<void> {
    try {
      await mutateAsync(id);
      toast.success("Deleted");
    } catch {
      toast.error("Could not delete");
    }
  }

  async function anotherAwait(): Promise<void> {
    try {
      await deletePlan(id);
      await refreshList();
    } catch {
      toast.error("Could not refresh");
    }
  }

  return {
    unwrapped,
    fireAndForget,
    narrowed,
    earlyReturn,
    destructured,
    guarded,
    bothPaths,
    passedOn,
    rejects,
    anotherAwait,
  };
}

export async function readAfterTest(
  save: () => ReturnType<ReturnType<typeof useSaveSettingsMutation>[0]>,
): Promise<string | undefined> {
  const result = await save();
  const theme = "data" in result ? result.data?.theme : undefined;
  const again = result.error === undefined && result.data.theme;
  return theme ?? (again || undefined);
}

export async function resultValueAfterTest(name: string): Promise<void> {
  const saved = await saveUser(name);
  const done = saved.ok ? saved.value : undefined;
  toast.success(String(done));
}

export function usePending(setSaving: (saving: boolean) => void) {
  const [saveSettings] = useSaveSettingsMutation();
  const [deletePlan] = useDeletePlanMutation();

  async function lastStatement(id: string): Promise<void> {
    await deletePlan(id);
  }

  async function pendingOnly(values: Settings): Promise<void> {
    setSaving(true);
    await saveSettings(values);
    setSaving(false);
  }

  async function pendingAfterCheck(values: Settings): Promise<void> {
    setSaving(true);
    const result = await saveSettings(values);
    if (result.error) toast.error("Could not save");
    setSaving(false);
  }

  return { lastStatement, pendingOnly, pendingAfterCheck };
}

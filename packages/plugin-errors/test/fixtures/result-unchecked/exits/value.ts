import { dispatch, getFolder, toast, useDeletePlanMutation, useSaveSettingsMutation } from "./api.js";
import type { Settings } from "./api.js";

export function usePlanNames() {
  const [deletePlan] = useDeletePlanMutation();
  const [saveSettings] = useSaveSettingsMutation();

  // The function returns a value: `return;` would not compile here.
  async function nameOf(id: string): Promise<string> {
    const outcome = await deletePlan(id);
    if ("error" in outcome) {
      toast.error("failed");
    }
    toast.success("done");
    return id;
  }

  // The function returns nothing, with no annotation.
  async function saveQuietly(values: Settings) {
    const result = await saveSettings(values);
    if (result.error) {
      toast.error("failed");
    }
    toast.success("saved");
  }

  // Only `data` is taken out: there is no `result` to check.
  async function removed(id: string): Promise<string> {
    const { data } = await deletePlan(id);
    toast.success(`Deleted ${String(data)}`);
    return id;
  }

  // A `catch` with a rollback: `return` would skip it.
  async function guarded(values: Settings, undo: () => void): Promise<void> {
    try {
      const result = await saveSettings(values);
      if ("error" in result) {
        toast.error("failed");
      }
      toast.success("saved");
    } catch {
      undo();
    }
  }

  // The data is read before the failure is checked, in a function that returns a value.
  async function loaded(id: string): Promise<string> {
    const { data, error } = await dispatch(getFolder.initiate(id));
    toast.success(data?.name ?? "");
    return error === undefined ? id : "";
  }

  // The data is read before the check, in a `try` with a rollback.
  async function loadedGuarded(values: Settings, undo: () => void): Promise<void> {
    try {
      const result = await saveSettings(values);
      toast.success(result.data?.theme ?? "");
    } catch {
      undo();
    }
  }

  // `isError` only: the error itself is not taken out.
  async function refreshed(id: string, undo: () => void): Promise<void> {
    try {
      const { data, isError } = await dispatch(getFolder.initiate(id));
      if (isError) {
        toast.error("failed");
      }
      toast.success(data?.name ?? "");
    } catch {
      undo();
    }
  }

  // The `if` does not test the result itself.
  async function conflict(values: Settings): Promise<string> {
    const result = await saveSettings(values);
    if (result.error && result.error.status === 409) toast.error("changed elsewhere");
    return values.theme;
  }

  return { conflict, nameOf, saveQuietly, removed, guarded, loaded, loadedGuarded, refreshed };
}

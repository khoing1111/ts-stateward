import { saveUser, toast, useCreatePlanMutation, useSaveSettingsMutation } from "./api.js";
import type { Settings } from "./api.js";

export function useSettingsForm(setOpen: (open: boolean) => void) {
  const [saveSettings] = useSaveSettingsMutation();
  const [createPlan] = useCreatePlanMutation();

  async function save(values: Settings): Promise<void> {
    const result = await saveSettings(values);
    if ("error" in result) {
      toast.error("Could not save");
    }
    toast.success("Saved");
  }

  async function saveAndClose(values: Settings): Promise<void> {
    const { error } = await saveSettings(values);
    if (error) toast.error("Could not save");
    setOpen(false);
  }

  async function create(name: string): Promise<string> {
    const created = await createPlan({ name });
    return `/plans/${created.data?.id ?? ""}`;
  }

  async function rename(name: string): Promise<void> {
    const saved = await saveUser(name);
    if (!saved.ok) toast.error(saved.error.message);
    setOpen(false);
  }

  async function conflict(values: Settings): Promise<void> {
    const result = await saveSettings(values);
    if (result.error && result.error.status === 409) toast.error("Changed elsewhere");
    toast.success("Saved");
  }

  return { save, saveAndClose, create, rename, conflict };
}

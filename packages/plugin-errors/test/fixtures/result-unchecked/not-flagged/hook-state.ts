import { toast, useCreatePlanMutation, useSaveSettingsMutation } from "./api.js";
import type { Settings } from "./api.js";

// The component shows the failure from the hook's own `isError` / `error`: stated intent.
export function useDraft(setOpen: (open: boolean) => void) {
  const [saveDraft, { isError }] = useSaveSettingsMutation();
  const [createPlan, creating] = useCreatePlanMutation();

  async function save(values: Settings): Promise<void> {
    const result = await saveDraft(values);
    if (result.error) toast.error("Could not save");
    setOpen(false);
  }

  async function create(name: string): Promise<string> {
    const created = await createPlan({ name });
    return created.data?.id ?? "";
  }

  async function createAndClose(name: string): Promise<void> {
    await createPlan({ name });
    setOpen(false);
  }

  return { save, create, createAndClose, failed: isError || creating.error !== undefined };
}

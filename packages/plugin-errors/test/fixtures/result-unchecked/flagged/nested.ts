import { toast, useSaveSettingsMutation } from "./api.js";
import type { Settings } from "./api.js";

export function useNestedForm(changed: boolean) {
  const [saveSettings] = useSaveSettingsMutation();

  async function inBlock(values: Settings): Promise<void> {
    if (changed) {
      const result = await saveSettings(values);
      if ("error" in result) {
        toast.error("failed");
      }
    }
    toast.success("saved");
  }

  async function inTry(values: Settings): Promise<void> {
    try {
      const result = await saveSettings(values);
      if ("error" in result) {
        toast.error("failed");
      }
    } catch {
      toast.error("crashed");
    }
    toast.success("saved");
  }

  async function inBlockInTry(values: Settings): Promise<void> {
    try {
      if (changed) {
        const result = await saveSettings(values);
        if (result.error) toast.error("failed");
      }
    } catch {
      toast.error("crashed");
    }
    toast.success("saved");
  }

  return { inBlock, inTry, inBlockInTry };
}

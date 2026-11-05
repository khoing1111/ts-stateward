import { toast, useSaveSettingsMutation } from "./api.js";
import type { Plan, Settings } from "./api.js";
import { useCreatePlanMutation } from "./api.js";

export function useNestedClean(changed: boolean, items: readonly Settings[]) {
  const [saveSettings] = useSaveSettingsMutation();
  const [createPlan] = useCreatePlanMutation();

  async function lastLine(values: Settings): Promise<void> {
    const result = await saveSettings(values);
    if ("error" in result) {
      toast.error("failed");
    }
  }

  async function lastInBlock(values: Settings): Promise<void> {
    if (changed) {
      const result = await saveSettings(values);
      if ("error" in result) {
        toast.error("failed");
      }
    }
  }

  async function leavesFunction(values: Settings): Promise<void> {
    if (changed) {
      const result = await saveSettings(values);
      if ("error" in result) {
        toast.error("failed");
      }
      return;
    }
    toast.success("saved");
  }

  async function inLoop(): Promise<void> {
    for (const values of items) {
      const result = await saveSettings(values);
      if ("error" in result) {
        toast.error("failed");
      }
    }
    toast.success("saved");
  }

  async function returnsInCheck(values: Settings): Promise<void> {
    if (changed) {
      const result = await saveSettings(values);
      if ("error" in result) {
        toast.error("failed");
        return;
      }
    }
    toast.success("saved");
  }

  async function refresh(): Promise<Plan | undefined> {
    const result = await createPlan({ name: "a" });
    return result.data;
  }

  async function refreshAll() {
    const result = await createPlan({ name: "a" });
    return result;
  }

  return { lastLine, lastInBlock, leavesFunction, inLoop, returnsInCheck, refresh, refreshAll };
}

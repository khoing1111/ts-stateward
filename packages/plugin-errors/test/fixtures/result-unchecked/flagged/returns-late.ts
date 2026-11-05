import { toast, useCreatePlanMutation } from "./api.js";
import type { Plan } from "./api.js";

export function useBetween() {
  const [createPlan] = useCreatePlanMutation();

  async function refresh(): Promise<Plan | undefined> {
    const result = await createPlan({ name: "a" });
    toast.success("created");
    return result.data;
  }

  return { refresh };
}

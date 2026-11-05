import { toast, useDeletePlanMutation } from "./api.js";

export function usePlanActions(id: string, onClose: () => void) {
  const [deletePlan] = useDeletePlanMutation();
  return async function remove(): Promise<void> {
    try {
      await deletePlan(id);
      toast.success("Deleted");
      onClose();
    } catch {
      toast.error("Could not delete the plan");
    }
  };
}

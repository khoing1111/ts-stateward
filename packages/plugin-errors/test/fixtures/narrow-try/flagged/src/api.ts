export class RequestError extends Error {}

export type Plan = { id: string; details: { title: string } };

export async function getPlan(id: string): Promise<Plan> {
  const response = await fetch(`/plans/${id}`);
  if (!response.ok) throw new RequestError(`plan ${id}: ${String(response.status)}`);
  return { id, details: { title: id } };
}

export async function savePlan(plan: Plan): Promise<void> {
  const response = await fetch(`/plans/${plan.id}`, { method: "PUT" });
  if (!response.ok) throw new RequestError(`plan ${plan.id}: ${String(response.status)}`);
}

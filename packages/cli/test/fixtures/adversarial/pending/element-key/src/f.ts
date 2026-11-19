import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

const store: { saving: Pending<boolean> } = { saving: false };

export async function save(): Promise<void> {
  if (store.saving) return;
  store["saving"] = true;
  await post();
  store.saving = false;
}

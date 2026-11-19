import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

class Store {
  saving: Pending<boolean> = false;
}

const store = new Store();

export async function save(): Promise<void> {
  if (store.saving) return;
  store.saving = true;
  try {
    await post();
  } finally {
    store.saving = false;
  }
}

import { getSettings, settings } from "./settings.js";
import { jobs, Store } from "./store.js";

export function viaAlias(): void {
  const s = settings;
  s.fontSize = 2;
  const { tags } = settings;
  tags.pop();
  getSettings().theme = "x";
  const picked = tags.length > 0 ? settings : undefined;
  if (picked) picked.theme = "y";
  Store.items[0] = "first";
  jobs.forEach((job) => {
    job.done = false;
  });
  for (const job of jobs) job.done = false;
}

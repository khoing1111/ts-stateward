// A const Record with literal keys, only read.
const titles: Record<string, string> = { idle: "Idle", done: "Done" };

export const idleTitle = titles.idle;
export const doneTitle = titles["done"];
export const hasIdle = "idle" in titles;
export type TitleKey = keyof typeof titles;

// Three fixed-key records that are only read. The test ignores two by name and by glob.
const ERROR_MESSAGES: Record<string, string> = { missing: "Missing", denied: "Denied" };
const legacy: Record<string, string> = { a: "A", b: "B" };
const titles: Record<string, string> = { idle: "Idle", done: "Done" };

export const missing = ERROR_MESSAGES.missing;
export const a = legacy.a;
export const idle = titles.idle;

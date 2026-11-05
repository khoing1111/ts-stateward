declare const status: "idle" | "failed";

const open: Record<string, string> = {};

// noUncheckedIndexedAccess adds undefined to the type: the code has to handle it.
export const length: number | undefined = open[status]?.length;
export const value: string | undefined = open[status];

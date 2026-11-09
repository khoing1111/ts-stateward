// A Map built from literal pairs and only read.
const codes = new Map<string, number>([
  ["ok", 200],
  ["missing", 404],
]);

export const okCode = codes.get("ok");
export const hasMissing = codes.has("missing");
export const total = codes.size;
// A key from outside whose miss is not handled: still a fixed table typed loosely.
export const codeOf = (name: string): number | undefined => codes.get(name);

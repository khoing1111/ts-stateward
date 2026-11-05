// Open dictionaries used correctly: every read with a wider key handles a missing entry, so typing the keys would only break the reads.
const roleLabels: Record<string, string> = { admin: "Admin", editor: "Editor" };
const keyDeltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
const escapes: Record<string, string> = { n: "\n", t: "\t" };
const imageTypes: Record<string, string> = { jpeg: "JPEG", png: "PNG" };
const attributes: Record<string, readonly string[]> = { a: ["href"], img: ["src"] };
const prefixes: Record<string, string> = { home: "home-editor", map: "map-editor" };
const protocols: Record<string, readonly string[]> = { href: ["http", "https"] };

export function label(role: string): string {
  return roleLabels[role] ?? role;
}

export function move(key: string, index: number): number {
  if (key in keyDeltas) return index + keyDeltas[key];
  return index;
}

export function unescape(char: string): string {
  return Object.hasOwn(escapes, char) ? escapes[char] : char;
}

export function typeName(subtype: string): string {
  return imageTypes[subtype] || subtype.toUpperCase();
}

export function allowed(tag: string, name: string): boolean {
  return attributes[tag]?.includes(name) === true;
}

export function draftKey(head: string): string | undefined {
  const prefix = prefixes[head];
  if (!prefix) return undefined;
  return `${prefix}:draft`;
}

export function safe(name: string, value: string): boolean {
  const allowedProtocols = protocols[name];
  return allowedProtocols === undefined || allowedProtocols.some((p) => value.startsWith(p));
}

const specialCases: Record<string, string> = { "application/pdf": "PDF" };

export function mimeLabel(type: string): string {
  if (specialCases[type]) {
    return specialCases[type];
  }
  return type;
}

// a Map read with a key from outside that handles a miss is an open
// dictionary too.
const reasonLabels = new Map<string, string>([
  ["timeout", "Timed out"],
  ["quota", "Over quota"],
]);
const shortcuts = new Map([
  ["k", "search"],
  ["/", "focus"],
]);

export function reasonText(reason: string): string {
  return reasonLabels.get(reason) ?? reason;
}

export function command(key: string): string | undefined {
  return shortcuts.has(key) ? shortcuts.get(key) : undefined;
}

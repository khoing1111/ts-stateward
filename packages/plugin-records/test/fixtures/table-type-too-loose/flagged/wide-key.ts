// Keys wider than the record's own that the read does not handle: `string` from a router, a
// literal the record does not have. `satisfies` alone would stop these reads compiling.
export const pageTitles: Record<string, string> = { "/": "Home", "/tasks": "Tasks" };
export const sizeNames: Record<string, string> = { s: "Small", m: "Medium" };
// One handled lookup does not cover another that is not handled.
export const roleLabels: Record<string, string> = { admin: "Admin", editor: "Editor" };

export function titleFor(pathname: string): string {
  return pageTitles[pathname];
}

export function huge(): string | undefined {
  return sizeNames["xl"];
}

export function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}

export function roleTitle(role: string): string {
  return roleLabels[role].toUpperCase();
}

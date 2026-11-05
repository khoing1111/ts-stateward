export class AccessError extends Error {}

declare function showError(message: unknown): void;

// The `try` is for the `throw`: a bug in `openPanel` would be shown as "No access".
export function enter(allowed: boolean, onOpen: () => void): void {
  try {
    if (!allowed) throw new AccessError("No access to this plan");
    onOpen();
  } catch (e) {
    showError(e);
  }
}

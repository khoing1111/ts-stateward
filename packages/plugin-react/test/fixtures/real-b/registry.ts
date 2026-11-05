type Listener = (online: boolean) => void;

const listeners = new Map<string, Listener>();

export const registry = {
  /** Returns how to unregister, or nothing when the name is unknown. */
  subscribe(name: string, listener: Listener): (() => void) | undefined {
    if (name.length === 0) return undefined;
    listeners.set(name, listener);
    return () => listeners.delete(name);
  },
};

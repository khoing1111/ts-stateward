export function createContext(value: null): string {
  return String(value);
}

export const Own = createContext(null);

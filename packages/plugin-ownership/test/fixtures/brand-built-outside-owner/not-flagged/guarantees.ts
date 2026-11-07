// A stated guarantee is not a brand: its `__guarantee` property is optional.
export type Settings = { theme: string } & { readonly __guarantee?: "owned" };

export function settings(theme: string): Settings {
  return { theme };
}

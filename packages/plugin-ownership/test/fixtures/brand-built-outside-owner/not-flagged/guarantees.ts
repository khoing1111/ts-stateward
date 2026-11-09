// A stated guarantee is not a brand: its `__guarantee` property is optional.
export type Settings = { theme: string } & { readonly __guarantee?: "owned" };

export function settings(theme: string): Settings {
  return { theme };
}

// The 1.2 form, one optional property per trait, is not a brand either.
export type Theme = { name: string } & { readonly "__guarantee:owned"?: true };

export function theme(name: string): Theme {
  return { name };
}

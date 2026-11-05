// A brand written by hand, with a string tag: this file owns it.
export type Email = string & { readonly __brand: "Email" };

export function email(text: string): Email | undefined {
  return text.includes("@") ? (text as Email) : undefined;
}

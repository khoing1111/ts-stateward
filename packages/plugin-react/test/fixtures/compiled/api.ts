export type Item = { id: string; name: string; price: number };
export type Profile = { name: string; email: string };

export const api = {
  save(items: readonly Item[]): Promise<void> {
    return Promise.resolve(items.length > 0 ? undefined : undefined);
  },
  readProfile(): Profile {
    return { name: "Ada", email: "ada@example.com" };
  },
};

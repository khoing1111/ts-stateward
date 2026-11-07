export type User = { id: string; name: string };

/** A loader that states it can be cancelled: it takes a signal and passes it on to `fetch`. */
export async function fetchUser(id: string, signal?: AbortSignal): Promise<User> {
  const response = await fetch(`/api/users/${id}`, { signal });
  return (await response.json()) as User;
}

/** The same, with the signal in an options object. */
export async function searchUsers(
  query: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<User[]> {
  const response = await fetch(`/api/users?q=${encodeURIComponent(query)}`, {
    signal: options?.signal,
  });
  return (await response.json()) as User[];
}

/** A loader that takes no signal: it cannot be cancelled. */
export async function loadUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return (await response.json()) as User;
}

/** A client in the style of axios: its own signal type, `signal` in the config. */
export type GenericAbortSignal = { readonly aborted: boolean };
export const http = {
  async get<T>(url: string, config?: { signal?: GenericAbortSignal }): Promise<{ data: T }> {
    void url;
    void config;
    return Promise.reject(new Error("not in tests"));
  },
};

/** A route hook in the style of react-router's. */
export function useParams(): { id: string } {
  return { id: "1" };
}

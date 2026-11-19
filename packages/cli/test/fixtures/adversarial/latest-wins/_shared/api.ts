export type User = { name: string };

export async function fetchUser(id: string, signal?: AbortSignal): Promise<User> {
  const response = await fetch(`/api/users/${id}`, { signal });
  return (await response.json()) as User;
}

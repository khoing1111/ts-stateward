export type User = { id: string; name: string };
export type Message = { id: string; text: string };

export async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return (await response.json()) as User;
}

export async function searchUsers(query: string): Promise<User[]> {
  const response = await fetch(`/api/users?q=${encodeURIComponent(query)}`);
  return (await response.json()) as User[];
}

export function filterUsers(users: readonly User[], query: string): User[] {
  return users.filter((user) => user.name.toLowerCase().includes(query.toLowerCase()));
}

type Listener = (message: Message) => void;

/** A chat connection: `subscribe` returns the function that unsubscribes. */
export const chat = {
  listeners: new Set<Listener>(),
  subscribe(room: string, listener: Listener): () => void {
    void room;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },
};

/** A stream in the style of RxJS: `subscribe` returns an object with `unsubscribe`. */
export const presence = {
  subscribe(next: (online: string[]) => void): { unsubscribe: () => void } {
    void next;
    return { unsubscribe: () => undefined };
  },
};

/** An event bus in the style of an emitter: `on` returns an unsubscribe function, and `off` with the same arguments ends it too. */
export const bus = {
  on(event: string, handler: () => void): () => void {
    void event;
    void handler;
    return () => undefined;
  },
  off(event: string, handler: () => void): void {
    void event;
    void handler;
  },
};

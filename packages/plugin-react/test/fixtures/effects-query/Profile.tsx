import { useEffect, useState } from "react";

type User = { id: string; name: string };

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return (await response.json()) as User;
}

export function Profile({ userId, first, last }: { userId: string; first: string; last: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(`${first} ${last}`);
  }, [first, last]);
  useEffect(() => {
    void (async () => {
      setUser(await fetchUser(userId));
    })();
  }, [userId]);
  return (
    <p>
      {fullName}: {user?.name}
    </p>
  );
}

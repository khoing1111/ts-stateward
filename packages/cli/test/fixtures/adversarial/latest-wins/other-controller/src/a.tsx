import { useEffect, useState } from "react";
import { fetchUser, type User } from "./api.js";

export function Profile({ id }: { id: string }) {
  const [user, setUser] = useState<User>();
  useEffect(() => {
    const controller = new AbortController();
    const other = new AbortController();
    void fetchUser(id, controller.signal).then(setUser);
    return () => other.abort();
  }, [id]);
  return <p>{user?.name}</p>;
}

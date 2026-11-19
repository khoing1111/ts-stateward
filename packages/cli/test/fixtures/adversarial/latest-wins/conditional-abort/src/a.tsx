import { useEffect, useState } from "react";
import { fetchUser, type User } from "./api.js";

export function Profile({ id, keep }: { id: string; keep: boolean }) {
  const [user, setUser] = useState<User>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchUser(id, controller.signal).then(setUser);
    return () => {
      if (keep) controller.abort();
    };
  }, [id, keep]);
  return <p>{user?.name}</p>;
}

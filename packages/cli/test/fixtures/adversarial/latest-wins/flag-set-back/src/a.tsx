import { useEffect, useState } from "react";
import { fetchUser, type User } from "./api.js";

export function Profile({ id }: { id: string }) {
  const [user, setUser] = useState<User>();
  useEffect(() => {
    let active = true;
    void (async () => {
      const found = await fetchUser(id);
      active = true;
      if (!active) return;
      setUser(found);
    })();
    return () => {
      active = false;
    };
  }, [id]);
  return <p>{user?.name}</p>;
}

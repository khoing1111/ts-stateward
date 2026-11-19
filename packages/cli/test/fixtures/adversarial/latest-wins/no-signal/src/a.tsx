import { useEffect, useState } from "react";
import { fetchUser, type User } from "./api.js";

export function Profile({ id }: { id: string }) {
  const [user, setUser] = useState<User>();
  useEffect(() => {
    let stale = false;
    void fetchUser(id).then((found) => {
      if (!stale) setUser(found);
    });
    return () => {
      stale = false;
    };
  }, [id]);
  return <p>{user?.name}</p>;
}

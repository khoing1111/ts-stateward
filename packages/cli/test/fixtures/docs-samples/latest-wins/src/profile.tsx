import { useEffect, useState } from "react";
import { fetchUser, type User } from "./api";

export function Profile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]);
  return <p>{user?.name}</p>;
}

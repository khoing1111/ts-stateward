import { useEffect, useState } from "react";
import { loadUser, useParams, type User } from "./api.js";

/** No signal can be passed; a prop in the dependencies; a write after an await. */
export function Profile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const run = async () => {
      setUser(await loadUser(userId));
    };
    void run();
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** A route parameter. */
export function Page() {
  const { id } = useParams();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    void (async () => {
      const loaded = await loadUser(id);
      setUser(loaded);
    })();
  }, [id]);
  return <p>{user?.name}</p>;
}

/** Local state in the dependencies, not a prop or a route parameter: not guessed. */
export function Picker() {
  const [id, setId] = useState("1");
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    void (async () => {
      setUser(await loadUser(id));
    })();
  }, [id]);
  return <button onClick={() => setId("2")}>{user?.name}</button>;
}

/** A `.then` on a call that takes no signal: not guessed. */
export function Then({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    void loadUser(userId).then(setUser);
  }, [userId]);
  return <p>{user?.name}</p>;
}

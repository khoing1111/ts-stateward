import { useEffect, useState } from "react";
import { fetchUser, type User } from "./api.js";

/** A `.catch` with a block that shows an error. */
export function Chained({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    fetchUser(userId)
      .then(setUser)
      .catch((reason) => {
        setFailure(String(reason));
      });
  }, [userId]);
  return <p>{user?.name ?? failure}</p>;
}

/** A `try` around the awaited call. */
export function Tried({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const run = async () => {
      try {
        setUser(await fetchUser(userId));
      } catch (error) {
        setFailure(String(error));
      }
    };
    void run();
  }, [userId]);
  return <p>{user?.name ?? failure}</p>;
}

/** The handler is a function of the component: no line can be put in it. */
export function Handed({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    fetchUser(userId).then(setUser).catch(setFailure);
  }, [userId]);
  return <p>{user?.name ?? String(failure)}</p>;
}

/** No handler at all: nothing to say about one. */
export function Bare({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]);
  return <p>{user?.name}</p>;
}

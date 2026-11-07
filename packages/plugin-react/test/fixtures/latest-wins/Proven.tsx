import { useCallback, useEffect, useState } from "react";
import { fetchUser, http, searchUsers, type User } from "./api.js";

/** The controller's signal in an options object, after an await. */
export function Search({ query }: { query: string }) {
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      const found = await searchUsers(query, { signal: controller.signal });
      setUsers(found);
    }
    void run();
    return () => controller.abort();
  }, [query]);
  return <p>{users.length}</p>;
}

/** The signal as a parameter, in a `.then`; `fetch` itself with `{ signal }` destructured. */
export function Profile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [raw, setRaw] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    fetchUser(userId, controller.signal).then(setUser);
    fetch(`/api/raw/${userId}`, { signal })
      .then((response) => response.text())
      .then((text) => setRaw(text));
    return () => {
      controller.abort();
    };
  }, [userId]);
  return <p>{user?.name ?? raw}</p>;
}

/** An options object written first; axios's own signal type. */
export function Remote({ url }: { url: string }) {
  const [data, setData] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const config = { signal: controller.signal };
    http.get<string>(url, config).then((response) => setData(response.data));
    return () => controller.abort();
  }, [url]);
  return <p>{data}</p>;
}

/** A function of the effect receives the signal; every call of it passes the effect's. */
export function Received({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = async (signal: AbortSignal) => {
      const loaded = await fetchUser(userId, signal);
      setUser(loaded);
    };
    void load(controller.signal);
    return () => controller.abort();
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** A function of the component that sets state, given the effect's signal. */
export function Callback({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const load = useCallback(
    async (signal: AbortSignal) => {
      setUser(await fetchUser(userId, signal));
    },
    [userId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return <p>{user?.name}</p>;
}

/** The React docs' flag: the cleanup sets it, each write checks it. */
export function Flagged({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    let ignore = false;
    fetchUser(userId).then((loaded) => {
      if (!ignore) setUser(loaded);
    });
    return () => {
      ignore = true;
    };
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** A flag that starts true, and an early exit. */
export function Active({ query }: { query: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      const found = await searchUsers(query);
      if (!active) return;
      setUsers(found);
      active && setCount(found.length);
    })();
    return () => {
      active = false;
    };
  }, [query]);
  return <p>{users.length + count}</p>;
}

/** Runs once: no newer request can overtake it. */
export function Me() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser("me").then(setUser);
  }, []);
  return <p>{user?.name}</p>;
}

/** An early `return undefined;` is no cleanup; the flag the returned cleanup sets is checked. */
export function Early({ query }: { query: string }) {
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    if (query === "") return undefined;
    let cancelled = false;
    void searchUsers(query).then((found) => {
      if (!cancelled) setUsers(found);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);
  return <p>{users.length}</p>;
}

import { useEffect, useRef, useState } from "react";
import { fetchUser, searchUsers, type User } from "./api.js";

/** No signal passed. */
export function Profile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** `fetch` with options but no signal, after an await; the cleanup already does other work. */
export function Raw({ url }: { url: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const timer = setInterval(() => undefined, 1000);
    const run = async () => {
      const response = await fetch(url, { cache: "no-store" });
      setText(await response.text());
    };
    void run();
    return () => {
      clearInterval(timer);
    };
  }, [url]);
  return <p>{text}</p>;
}

/** A controller whose signal is passed, but never aborted. */
export function NotAborted({ query }: { query: string }) {
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    searchUsers(query, { signal: controller.signal }).then(setUsers);
  }, [query]);
  return <p>{users.length}</p>;
}

/** A signal from a controller the effect does not create. */
export function Foreign({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    fetchUser(userId, controller.current.signal).then(setUser);
    return () => controller.current.abort();
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** A flag the cleanup sets, but the write does not check it. */
export function Unchecked({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    let ignore = false;
    fetchUser(userId).then(setUser);
    return () => {
      ignore = true;
    };
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** A function of the component that sets state, called without a signal. */
export function Reload({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const load = async (signal?: AbortSignal) => {
    setUser(await fetchUser(userId, signal));
  };
  useEffect(() => {
    void load();
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** A cleanup stateward cannot read. */
export function Unreadable({ userId, stop }: { userId: string; stop: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchUser(userId, controller.signal).then(setUser);
    return stop;
  }, [userId, stop]);
  return <p>{user?.name}</p>;
}

/** The flag is tested when the request starts, not when its answer arrives. */
export function CheckedTooEarly({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    let ignore = false;
    if (!ignore) {
      fetchUser(userId).then((loaded) => setUser(loaded));
    }
    return () => {
      ignore = true;
    };
  }, [userId]);
  return <p>{user?.name}</p>;
}

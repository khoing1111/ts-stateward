import { useEffect, useRef, useState } from "react";
import { fetchUser, type User } from "./api.js";

type ProfileProps = { userId: string; first: string; last: string };

export function ProfileHeader({ first, last }: ProfileProps) {
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(`${first} ${last}`);
  }, [first, last]);
  return <h1>{fullName}</h1>;
}

export function ProfileHeaderFixed({ first, last }: ProfileProps) {
  const fullName = `${first} ${last}`;
  return <h1>{fullName}</h1>;
}

/** The name can also be edited, so the state is not only derived. */
export function EditableHeader({ first, last }: ProfileProps) {
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(`${first} ${last}`);
  }, [first, last]);
  return <input value={fullName} onChange={(event) => setFullName(event.target.value)} />;
}

export function NameEditor(props: { name: string; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(props.name);
  useEffect(() => {
    setDraft(props.name);
  }, [props.name]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

export function NameEditorFixed({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

export function ProfileCard({ userId }: ProfileProps) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser(userId).then((loaded) => setUser(loaded));
  }, [userId]);
  return <p>{user?.name}</p>;
}

export function ProfileCardFixed({ userId }: ProfileProps) {
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

/** Loaded once: no newer request can overtake it. */
export function CurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser("me").then(setUser);
  }, []);
  return <p>{user?.name}</p>;
}

/** real-world corpus (excalidraw's export preview): a request id in a ref, checked before the write. */
export function ProfilePreview({ userId }: ProfileProps) {
  const [user, setUser] = useState<User | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    const request = ++latest.current;
    const isStale = () => request !== latest.current;
    fetchUser(userId).then((loaded) => {
      if (isStale()) return;
      setUser(loaded);
    });
  }, [userId]);
  return <p>{user?.name}</p>;
}

/** real-world corpus (excalidraw's mermaid loader): the update keeps the state unless it is still current. */
export function ProfileKept({ userId }: ProfileProps) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser(userId).then((loaded) => {
      setUser((previous) => (previous === null || previous.id === userId ? loaded : previous));
    });
  }, [userId]);
  return <p>{user?.name}</p>;
}

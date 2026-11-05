import { memo, useEffect, useState } from "react";

type User = { id: number; name: string };
declare function fetchUser(): Promise<User>;

// The classic trio: loading, error and data are one state, set together in the effect.
export function Profile() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<User | undefined>();

  useEffect(() => {
    setIsLoading(true);
    fetchUser()
      .then((user) => {
        setData(user);
        setIsLoading(false);
      })
      .catch((reason: Error) => {
        setError(reason);
        setIsLoading(false);
      });
  }, []);

  if (isLoading) return <p>loading</p>;
  if (error) return <p>{error.message}</p>;
  return <p>{data?.name}</p>;
}

// Read together in one condition: a form's flags. It is a guess, hence a warning.
export function Panel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>toggle</button>
      <input onChange={() => setIsDirty(true)} />
      {isOpen && isDirty && <p>unsaved changes</p>}
    </div>
  );
}

// A hook; the states are read in one ternary test, and four are involved.
export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const label = uploading || failure || cancelled || url ? "busy" : "none";
  return { label, setUploading, setFailure, setUrl, setCancelled };
}

// An unrelated first state is not part of the finding; it is reported at the first one involved.
export function Mixed() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Error | null>(null);

  const submit = () => {
    setBusy(true);
    setProblem(null);
  };
  return <button onClick={() => (open ? setOpen(false) : submit())}>{busy && !problem}</button>;
}

// Five variables: the headline lists three and counts the rest.
export function Many() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [c, setC] = useState(false);
  const [d, setD] = useState(false);
  const [e, setE] = useState(false);
  return (
    <button
      onClick={() => {
        setA(true);
        setB(true);
        setC(true);
        setD(true);
        setE(true);
      }}
    >
      {String(a || b || c || d || e)}
    </button>
  );
}

// Wrapped in memo, still a component by its name; the data type is too long for the example.
export const Wrapped = memo(() => {
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState<
    Record<string, { identifier: number; displayName: string; tags: string[] }> | undefined
  >();
  return (
    <button
      onClick={() => {
        setLoading(true);
        setValue(undefined);
      }}
    >
      {loading && value ? "x" : "y"}
    </button>
  );
});

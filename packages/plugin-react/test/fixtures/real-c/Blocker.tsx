import { useCallback, useEffect, useState } from "react";

/**
 * `shouldBlock` follows `isDirty`, except that proceeding sets it to `false`
 * until `isDirty` changes again.
 */
export function LeaveGuard({ isDirty }: { isDirty: boolean }) {
  const [shouldBlock, setShouldBlock] = useState(isDirty);
  useEffect(() => {
    setShouldBlock(isDirty);
  }, [isDirty]);
  const handleProceed = () => {
    setShouldBlock(false);
  };
  return <button onClick={handleProceed}>{shouldBlock ? "Leave anyway" : "Leave"}</button>;
}

/** Set to a constant from a JSX handler and through `useCallback`, with a non-boolean value. */
export function Filter({ query }: { query: string }) {
  const [text, setText] = useState(query);
  useEffect(() => {
    setText(query);
  }, [query]);
  const onClear = useCallback(() => setText(""), []);
  return (
    <p>
      {text}
      <button onClick={onClear}>Clear</button>
    </p>
  );
}

/** Set to a constant, and also from an input: a draft, so the `key` advice stays. */
export function Note({ body }: { body: string }) {
  const [draft, setDraft] = useState(body);
  useEffect(() => {
    setDraft(body);
  }, [body]);
  return (
    <>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={() => setDraft("")}>Clear</button>
    </>
  );
}

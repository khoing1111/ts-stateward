import { useEffect, useState } from "react";

export function Note({ body }: { body: string }) {
  const [draft, setDraft] = useState(body);
  useEffect(() => {
    setDraft(body);
  }, [body]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

export function NotePage({ id, body }: { id: string; body: string }) {
  return <Note key={id} body={body} />;
}

import { useEffect, useState } from "react";

/** Appends the entry it is given each time the entry changes. */
export function Log({ entry }: { entry: string }) {
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    setLog([...log, entry]);
  }, [log, entry]);
  return <ul>{log.map((line) => <li key={line}>{line}</li>)}</ul>;
}

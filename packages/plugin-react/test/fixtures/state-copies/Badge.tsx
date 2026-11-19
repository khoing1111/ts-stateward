import { useEffect, useState } from "react";

export function Badge({ label }: { label: string }) {
  const [shown, setShown] = useState(label);
  useEffect(() => {
    setShown(label);
  }, [label]);
  return <b>{shown}</b>;
}

export function Page({ title }: { title: string }) {
  return <Badge label={title} />;
}

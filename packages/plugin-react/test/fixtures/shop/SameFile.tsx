import { useEffect, useState } from "react";

/** Declared in this file: exhaustive-deps does not see through the hook's return, so it is reported. */
function useToggle() {
  const [on, setOn] = useState(false);
  const toggle = () => setOn((current) => !current);
  return { on, toggle };
}

export function Switch() {
  const { on, toggle } = useToggle();
  useEffect(() => {
    if (on) toggle();
  }, [on, toggle]);
  return <p>{String(on)}</p>;
}

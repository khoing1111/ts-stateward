import { useRef, useState } from "react";
import { useNavigate } from "./router.js";

/** The timer navigates; the import line has no `useEffect` yet. */
export function RailMenu({ to }: { to: string }) {
  const navigate = useNavigate();
  const goTimer = useRef<number | undefined>(undefined);
  const choose = () => {
    goTimer.current = window.setTimeout(() => navigate(to), 200);
  };
  return <button onClick={choose}>go</button>;
}

/** A timer that logs to the console: nothing the rule names. */
export function Logger() {
  const [hovered, setHovered] = useState(false);
  const logTimer = useRef<number | undefined>(undefined);
  const log = () => {
    logTimer.current = window.setTimeout(() => {
      console.log("hover");
      setHovered(true);
    }, 200);
  };
  return <button onClick={log}>{String(hovered)}</button>;
}

import { Profile } from "./Profile";
import { toast } from "./toast";

export function Dashboard() {
  const open = () => toast(<Profile />);
  const stored = <Profile />;
  localStorage.setItem("last", String(stored));
  return <button onClick={open}>open</button>;
}

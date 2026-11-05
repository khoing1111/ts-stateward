import { useSession } from "./hooks";

export function Greeting() {
  const session = useSession();
  return <p>{session.name}</p>;
}

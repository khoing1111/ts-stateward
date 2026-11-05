import { useSession } from "./useSession";

export function Profile() {
  const user = useSession();
  return <h1>{user.name}</h1>;
}

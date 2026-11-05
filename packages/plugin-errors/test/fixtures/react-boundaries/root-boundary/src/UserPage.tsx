import { useUser } from "./users";

export function UserPage() {
  const user = useUser("1");
  return <h1>{user.name}</h1>;
}

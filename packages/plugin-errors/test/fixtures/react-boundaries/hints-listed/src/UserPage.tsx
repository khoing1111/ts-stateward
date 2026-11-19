import { useUser } from "./users";

export function UserPage({ id }: { id: string }) {
  const user = useUser(id);
  return <h1>{user.name}</h1>;
}

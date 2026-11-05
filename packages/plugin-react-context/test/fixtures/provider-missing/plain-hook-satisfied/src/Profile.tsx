import { useAuth } from "./auth";

export function Profile() {
  const user = useAuth();
  return <h1>{user.name}</h1>;
}

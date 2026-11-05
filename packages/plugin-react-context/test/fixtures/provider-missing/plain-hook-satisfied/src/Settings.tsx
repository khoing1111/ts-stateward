import { useAuth } from "./auth";

export function Settings() {
  const user = useAuth();
  return <p>{user.name}</p>;
}

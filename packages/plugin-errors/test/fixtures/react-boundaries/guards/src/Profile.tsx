import { useAuth } from "./auth";
import { Card } from "./Card";

export function Profile() {
  const user = useAuth();
  return <Card title="Profile" body={user.name} />;
}

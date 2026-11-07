import { useAuth } from "./useAuth";

export function Profile() {
  return <h1>{useAuth().name}</h1>;
}

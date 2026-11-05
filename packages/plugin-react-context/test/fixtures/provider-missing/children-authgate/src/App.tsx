import { AuthGate } from "./AuthGate";
import { Profile } from "./Profile";

export function App() {
  return (
    <AuthGate>
      <Profile />
    </AuthGate>
  );
}

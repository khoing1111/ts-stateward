import { createRoot } from "react-dom/client";
import { AuthGate, LeakyGate, ThemeGate } from "./Gates";
import { Profile, Themed } from "./Profile";

createRoot(document.body).render(
  <>
    <AuthGate>
      <Profile />
    </AuthGate>
    <ThemeGate>
      <Themed />
    </ThemeGate>
    <LeakyGate>
      <Profile />
    </LeakyGate>
  </>,
);

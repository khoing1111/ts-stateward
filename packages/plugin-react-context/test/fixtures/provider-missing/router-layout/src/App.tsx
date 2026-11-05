import { Route, Routes } from "react-router-dom";
import { AuthGate } from "./AuthGate";
import { Layout } from "./Layout";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Profile } from "./Profile";
import { Shell } from "./Shell";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route
        element={
          <AuthGate>
            <Shell />
          </AuthGate>
        }
      >
        <Route path="/profile" element={<Profile />} />
      </Route>
    </Routes>
  );
}

import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { AuthProvider } from "./providers";

createRoot(document.body).render(
  <AuthProvider value={{ name: "ada" }}>
    <Dashboard />
  </AuthProvider>,
);

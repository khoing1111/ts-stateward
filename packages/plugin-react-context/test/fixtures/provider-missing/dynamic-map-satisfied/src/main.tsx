import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";
import { Dashboard } from "./Dashboard";

createRoot(document.body).render(
  <AuthCtx.Provider value={{ name: "ada" }}>
    <ThemeCtx.Provider value={{ dark: true }}>
      <Dashboard tab="settings" />
    </ThemeCtx.Provider>
  </AuthCtx.Provider>,
);

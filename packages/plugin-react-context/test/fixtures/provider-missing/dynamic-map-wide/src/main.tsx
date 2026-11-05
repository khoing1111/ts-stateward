import { createRoot } from "react-dom/client";
import { AuthCtx } from "./contexts";
import { Dashboard } from "./Dashboard";

createRoot(document.body).render(
  <AuthCtx.Provider value={{ name: "ada" }}>
    <Dashboard tab="profile" />
  </AuthCtx.Provider>,
);

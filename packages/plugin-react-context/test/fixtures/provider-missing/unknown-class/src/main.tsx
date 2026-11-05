import { createRoot } from "react-dom/client";
import { AuthCtx } from "./contexts";
import { ErrorBoundary } from "./ErrorBoundary";
import { Profile } from "./Profile";

createRoot(document.body).render(
  <AuthCtx.Provider value={{ name: "ada" }}>
    <ErrorBoundary>
      <Profile />
    </ErrorBoundary>
  </AuthCtx.Provider>,
);

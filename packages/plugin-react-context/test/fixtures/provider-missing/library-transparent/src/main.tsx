import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AuthCtx } from "./contexts";
import { Profile } from "./Profile";

createRoot(document.body).render(
  <StrictMode>
    <AuthCtx.Provider value={{ name: "ada" }}>
      <Suspense fallback={<p>loading</p>}>
        <Profile />
      </Suspense>
    </AuthCtx.Provider>
  </StrictMode>,
);

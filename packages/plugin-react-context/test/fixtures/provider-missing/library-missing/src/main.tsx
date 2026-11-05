import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Profile } from "./Profile";

createRoot(document.body).render(
  <StrictMode>
    <Suspense fallback={<p>loading</p>}>
      <Profile />
    </Suspense>
  </StrictMode>,
);

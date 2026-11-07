import { createRoot } from "react-dom/client";
import { AuthCtx } from "./contexts";
import { Profile } from "./Profile";

createRoot(document.body).render(
  <>
    <AuthCtx.Provider value={{ name: "ada" }}>
      <Profile />
    </AuthCtx.Provider>
    <Profile />
  </>,
);

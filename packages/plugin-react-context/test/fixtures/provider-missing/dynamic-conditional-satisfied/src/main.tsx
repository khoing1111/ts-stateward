import { createRoot } from "react-dom/client";
import { AuthCtx } from "./contexts";
import { Home } from "./Home";

createRoot(document.body).render(
  <AuthCtx.Provider value={{ name: "ada" }}>
    <Home signedIn />
  </AuthCtx.Provider>,
);

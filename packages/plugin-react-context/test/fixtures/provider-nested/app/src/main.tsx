import { createRoot } from "react-dom/client";
import { App, Other } from "./App";
import { SessionContext } from "./contexts";
import { StoreProvider } from "./Store";

createRoot(document.body).render(
  <StoreProvider>
    <SessionContext value={{ user: "Ada" }}>
      <App />
    </SessionContext>
  </StoreProvider>,
);

createRoot(document.getElementById("other") ?? document.body).render(
  <SessionContext value={{ user: "Grace" }}>
    <Other />
  </SessionContext>,
);

import { createRoot } from "react-dom/client";
import { ThemeCtx } from "@acme/ui";
import { Toolbar } from "./Toolbar";

createRoot(document.body).render(
  <>
    <ThemeCtx.Provider value={{ dark: true }}>
      <Toolbar />
    </ThemeCtx.Provider>
    <Toolbar />
  </>,
);

import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";

createRoot(document.body).render(<AuthCtx.Provider value={{ name: "ada" }}>
    <p>hello</p>
  </AuthCtx.Provider>);

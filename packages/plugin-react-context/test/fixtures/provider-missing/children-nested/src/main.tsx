import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";
import { App } from "./App";

createRoot(document.body).render(<App />);

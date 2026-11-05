import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";
import { Dashboard } from "./Dashboard";

createRoot(document.body).render(<Dashboard />);

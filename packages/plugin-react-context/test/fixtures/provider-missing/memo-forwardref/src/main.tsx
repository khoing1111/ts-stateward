import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";
import { Badge } from "./Badge";

createRoot(document.body).render(<Badge />);

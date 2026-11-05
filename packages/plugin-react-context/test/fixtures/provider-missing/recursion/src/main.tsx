import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";
import { Tree } from "./Tree";

createRoot(document.body).render(<Tree depth={3} />);

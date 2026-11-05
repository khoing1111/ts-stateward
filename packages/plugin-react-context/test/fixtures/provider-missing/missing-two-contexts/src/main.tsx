import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";
import { Profile } from "./Profile";

createRoot(document.body).render(<Profile />);

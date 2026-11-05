import { createRoot } from "react-dom/client";
import { AuthCtx, ThemeCtx } from "./contexts";
import { Step1 } from "./Step1";

createRoot(document.body).render(<Step1 />);

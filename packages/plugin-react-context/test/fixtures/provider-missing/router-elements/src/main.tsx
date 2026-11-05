import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";

createRoot(document.body).render(<RouterProvider router={router} />);

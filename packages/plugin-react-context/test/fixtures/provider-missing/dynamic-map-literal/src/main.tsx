import { createRoot } from "react-dom/client";
import { Account, Dashboard } from "./Dashboard";

createRoot(document.body).render(
  <>
    <Dashboard tab={3} />
    <Account />
  </>,
);

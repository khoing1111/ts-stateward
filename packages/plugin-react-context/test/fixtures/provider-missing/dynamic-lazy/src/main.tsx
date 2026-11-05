import { lazy } from "react";
import { createRoot } from "react-dom/client";
import { AuthCtx } from "./contexts";

const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const AccountPage = lazy(() => import("./pages/Account"));
const Page = location.hash === "#a" ? AccountPage : lazy(() => import("./pages/Settings"));

createRoot(document.body).render(
  <AuthCtx.Provider value={{ name: "ada" }}>
    <SettingsPage />
    <AccountPage />
    <Page />
  </AuthCtx.Provider>,
);

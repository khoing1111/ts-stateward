import { lazy } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./pages";

const LazyPage = lazy(() => import("./pages/Lazy"));

createRoot(document.body).render(
  <>
    <Dashboard />
    <LazyPage />
  </>,
);

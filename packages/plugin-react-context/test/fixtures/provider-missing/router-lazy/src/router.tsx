import React, { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { lazyComponent, withRetry } from "./lazy";

const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Billing = lazyComponent(() => import("./pages/Billing"));
const Reports = withRetry(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "settings", element: <Settings /> },
      { path: "billing", Component: Billing },
    ],
  },
  { path: "/reports", element: <Reports /> },
]);

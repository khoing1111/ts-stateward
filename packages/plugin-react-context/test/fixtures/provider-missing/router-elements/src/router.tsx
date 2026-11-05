import { createBrowserRouter, createRoutesFromElements, Route } from "react-router-dom";
import { Layout } from "./Layout";
import { Dashboard } from "./pages/Dashboard";

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Layout />}>
      <Route index element={<Dashboard />} />
    </Route>,
  ),
);

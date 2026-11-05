import { useRoutes } from "react-router-dom";
import { Layout } from "./Layout";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  return useRoutes([
    {
      path: "/",
      element: <Layout />,
      children: [{ index: true, element: <Dashboard /> }],
    },
  ]);
}

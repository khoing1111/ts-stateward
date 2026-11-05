import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Profile } from "./Profile";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "profile", Component: Profile },
    ],
  },
  { path: "/login", element: <Login /> },
]);

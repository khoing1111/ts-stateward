import { Route, Routes } from "react-router-dom";
import { Layout } from "./Layout";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}

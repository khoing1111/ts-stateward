import { createRoot } from "react-dom/client";
import { Dashboard } from "./Panels";

function App() {
  return <Dashboard tab="settings" />;
}

createRoot(document.body).render(<App />);

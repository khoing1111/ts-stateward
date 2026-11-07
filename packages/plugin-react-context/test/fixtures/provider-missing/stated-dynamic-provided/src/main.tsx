import { createRoot } from "react-dom/client";
import { ThemeCtx } from "./contexts";
import { Dashboard } from "./Panels";

function App() {
  return (
    <ThemeCtx.Provider value={{ dark: true }}>
      <Dashboard tab="settings" />
    </ThemeCtx.Provider>
  );
}

createRoot(document.body).render(<App />);

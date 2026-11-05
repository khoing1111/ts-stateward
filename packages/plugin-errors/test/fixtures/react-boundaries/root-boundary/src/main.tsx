import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { App } from "./App";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary fallback={<p>Something went wrong.</p>}>
    <App />
  </ErrorBoundary>,
);

import { ErrorBoundary } from "react-error-boundary";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Dashboard } from "./Dashboard";
import { Home } from "./Home";
import { SettingsPage } from "./SettingsPage";
import { Shell } from "./Shell";
import { UserErrorPage } from "./UserErrorPage";
import { UserPage } from "./UserPage";

export function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/users/:id" element={<UserPage />} />
          <Route
            path="/settings"
            element={
              <ErrorBoundary FallbackComponent={UserErrorPage}>
                <SettingsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/dashboard/:range"
            element={
              <ErrorBoundary
                fallbackRender={({ error }) =>
                  error instanceof SyntaxError ? <p>The stats are damaged.</p> : <p>{String(error)}</p>
                }
              >
                <Dashboard />
              </ErrorBoundary>
            }
          />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}

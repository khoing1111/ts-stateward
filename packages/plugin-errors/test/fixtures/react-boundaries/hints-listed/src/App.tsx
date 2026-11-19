import { ErrorBoundary } from "@sentry/react";
import { UserPage } from "./UserPage";

export function App() {
  return (
    <main>
      <ErrorBoundary fallback={<p>Something broke.</p>}>
        <UserPage id={location.hash.slice(1)} />
      </ErrorBoundary>
    </main>
  );
}

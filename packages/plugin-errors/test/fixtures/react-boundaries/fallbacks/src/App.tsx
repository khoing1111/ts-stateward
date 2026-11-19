import { ErrorBoundary } from "react-error-boundary";
import { AuthError } from "./errors";
import { Fallback } from "./Fallback";
import { Guard } from "./Guard";
import { SettingsPage } from "./SettingsPage";

export function App() {
  return (
    <main>
      <ErrorBoundary FallbackComponent={Fallback}>
        <SettingsPage />
      </ErrorBoundary>
      <ErrorBoundary
        fallbackRender={({ error }) => {
          if (error instanceof AuthError) return <p>Please sign in.</p>;
          return null;
        }}
      >
        <SettingsPage />
      </ErrorBoundary>
      <ErrorBoundary
        fallback={<p>Something broke.</p>}
        onError={(error) => {
          if (error instanceof AuthError) console.warn("signed out");
        }}
      >
        <SettingsPage />
      </ErrorBoundary>
      <Guard>
        <SettingsPage />
      </Guard>
    </main>
  );
}

import { ErrorBoundary } from "./ErrorBoundary";
import { UserPage } from "./UserPage";

function Footer() {
  return <footer>2026</footer>;
}

export function App() {
  return (
    <main>
      <ErrorBoundary>
        <Footer />
      </ErrorBoundary>
      <UserPage id={location.hash.slice(1)} />
    </main>
  );
}

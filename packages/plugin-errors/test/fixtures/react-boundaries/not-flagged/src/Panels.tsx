import { ErrorBoundary } from "react-error-boundary";
import { SettingsPage } from "./SettingsPage";
import { UserPage } from "./UserPage";

declare function showToast(body: JSX.Element): string;

/** JSX in a `const`: rendered where `{content}` is, inside the boundary. */
export function ProfilePanel() {
  const content = <UserPage />;
  return <ErrorBoundary fallback={<p>This profile could not be shown.</p>}>{content}</ErrorBoundary>;
}

/** JSX in a `let` set in two branches: each is rendered inside the boundary. */
export function SettingsPanel({ compact }: { compact: boolean }) {
  let content;
  if (compact) content = <SettingsPage />;
  else content = <section>{<SettingsPage />}</section>;
  return <ErrorBoundary fallback={<p>Settings are unavailable.</p>}>{content}</ErrorBoundary>;
}

/** JSX passed to a function: where it is rendered cannot be followed, so nothing is said. */
export function Toasted() {
  const id = showToast(<UserPage />);
  return <p>Toast {id}</p>;
}

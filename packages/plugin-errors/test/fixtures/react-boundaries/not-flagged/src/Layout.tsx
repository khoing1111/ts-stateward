import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorPage } from "./ErrorPage";
import { HttpError, ParseError } from "./errors";

/** Every page renders inside this boundary, as `children`. */
export function Layout({ children }: { children?: ReactNode }) {
  return (
    <main>
      <ErrorBoundary
        FallbackComponent={ErrorPage}
        onError={(error) => {
          // HttpError covers NotFoundError, which extends it.
          if (error instanceof HttpError) console.warn(error.message);
          else if (error instanceof ParseError) localStorage.removeItem("settings");
        }}
      >
        {children}
      </ErrorBoundary>
    </main>
  );
}

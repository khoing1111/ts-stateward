// The part of react-error-boundary's API the fixtures use, declared the way the package does.
import { Component, type ComponentType, type ReactNode } from "react";

export type FallbackProps = { error: unknown; resetErrorBoundary: () => void };
export type ErrorBoundaryProps = {
  children?: ReactNode;
  fallback?: ReactNode;
  FallbackComponent?: ComponentType<FallbackProps>;
  fallbackRender?: (props: FallbackProps) => ReactNode;
  onError?: (error: unknown, info: { componentStack?: string | null }) => void;
};
export declare class ErrorBoundary extends Component<ErrorBoundaryProps> {}

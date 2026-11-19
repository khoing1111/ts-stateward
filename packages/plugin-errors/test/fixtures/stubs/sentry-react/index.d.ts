// The part of Sentry's React API the fixtures use: an error boundary with a `fallback`.
import { Component, type ReactNode } from "react";

export type ErrorBoundaryProps = { children?: ReactNode; fallback?: ReactNode };
export declare class ErrorBoundary extends Component<ErrorBoundaryProps> {}

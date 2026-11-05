// The part of react-dom/client the boundary fixtures use.
import type { ReactNode } from "react";

export type Root = { render(node: ReactNode): void };
export declare function createRoot(container: Element | null): Root;

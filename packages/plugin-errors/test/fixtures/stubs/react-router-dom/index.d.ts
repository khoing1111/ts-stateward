// The part of React Router's API the boundary fixtures use, declared the way the package does.
import type { ReactElement, ReactNode } from "react";

export declare function BrowserRouter(props: { children?: ReactNode }): ReactElement;
export declare function Routes(props: { children?: ReactNode }): ReactElement | null;
export declare function Route(props: { path?: string; element?: ReactNode }): ReactElement | null;
export declare function useParams(): Readonly<Record<string, string | undefined>>;

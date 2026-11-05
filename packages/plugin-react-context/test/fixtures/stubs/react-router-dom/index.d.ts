// The part of React Router's API that the router fixtures use, declared the way the package does.
import type { ComponentType, ReactElement, ReactNode } from "react";

export type RouteObject = {
  path?: string;
  index?: boolean;
  element?: ReactNode;
  Component?: ComponentType;
  errorElement?: ReactNode;
  children?: RouteObject[];
};
export type RouteProps = {
  path?: string;
  index?: boolean;
  element?: ReactNode;
  Component?: ComponentType | null;
  children?: ReactNode;
};
export type Router = { routes: RouteObject[] };

export declare function Route(props: RouteProps): ReactElement | null;
export declare function Routes(props: { children?: ReactNode }): ReactElement | null;
export declare function Outlet(props: object): ReactElement | null;
export declare function createBrowserRouter(routes: RouteObject[]): Router;
export declare function createRoutesFromElements(children: ReactNode): RouteObject[];
export declare function useRoutes(routes: RouteObject[]): ReactElement | null;
export declare function RouterProvider(props: { router: Router }): ReactElement;

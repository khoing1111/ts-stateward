import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { load } from "./lazy";

const A = load(() => import("./pages/A").then((m) => m.default));
const B = load(() => import("./pages/B").then((m) => m.B));
const C = load(() => import("./pages/C").then(({ C }) => ({ default: C })));
const D = load(() => Promise.all([import("./pages/D1"), import("./pages/D2")]).then(([d]) => d));
const E = load(() =>
  Promise.all([import("./pages/E1"), import("./pages/E2")]).then(([, e]) => ({ default: e.E })),
);
const F = load(() => import("./pages/F").then((m) => Object.values(m)[0]));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, Component: A },
      { path: "b", Component: B },
      { path: "c", Component: C },
      { path: "d", Component: D },
      { path: "e", Component: E },
      { path: "f", element: <F /> },
    ],
  },
]);

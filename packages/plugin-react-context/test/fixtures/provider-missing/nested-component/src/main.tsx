import { createRoot } from "react-dom/client";
import { Bare, Page } from "./Pages";

createRoot(document.body).render(
  <>
    <Page />
    <Bare />
  </>,
);

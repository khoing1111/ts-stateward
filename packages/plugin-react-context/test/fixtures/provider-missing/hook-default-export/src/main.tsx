import { createRoot } from "react-dom/client";
import { Farewell } from "./Farewell";
import { Greeting } from "./Greeting";

createRoot(document.body).render(
  <>
    <Greeting />
    <Farewell />
  </>,
);

import { createRoot } from "react-dom/client";
import { ThemeCtx } from "./contexts";
import { Plain, WithConsumer, WithHook, WithUse } from "./Readers";

createRoot(document.body).render(
  <ThemeCtx value={{ dark: true }}>
    <Plain />
    <WithUse />
    <WithConsumer />
    <WithHook />
  </ThemeCtx>,
);

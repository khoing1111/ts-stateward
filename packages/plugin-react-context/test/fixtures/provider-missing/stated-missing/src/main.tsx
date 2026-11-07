import { createRoot } from "react-dom/client";
import { ThemeCtx } from "./contexts";
import { Plain, WithConsumer, WithHook, WithUse } from "./Readers";

function Page() {
  return (
    <main>
      <WithUse />
      <WithConsumer />
      <WithHook />
    </main>
  );
}

createRoot(document.body).render(
  <>
    <ThemeCtx.Provider value={{ dark: true }}>
      <Plain />
    </ThemeCtx.Provider>
    <Page />
  </>,
);

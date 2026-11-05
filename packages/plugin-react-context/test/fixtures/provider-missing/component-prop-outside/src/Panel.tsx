import type { ComponentType } from "react";

export function Panel({ as: As }: { as: ComponentType }) {
  return (
    <section>
      <As />
    </section>
  );
}

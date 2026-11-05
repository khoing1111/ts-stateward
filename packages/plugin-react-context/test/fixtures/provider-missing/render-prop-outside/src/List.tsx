import type { ReactNode } from "react";

export function List({ renderItem }: { renderItem: (id: number) => ReactNode }) {
  return <ul>{renderItem(1)}</ul>;
}

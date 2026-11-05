import { LabelError } from "./errors";

export function useLabel(label: string | undefined): string {
  if (label === undefined) throw new LabelError("no label");
  return label.trim();
}

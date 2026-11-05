import { RequiredTitleError, TitleError } from "./errors";

/**
 * A check on a prop its type already requires: only a caller that breaks the types reaches it,
 * so it is left out.
 */
export function Title({ title }: { title: string }) {
  if (title === undefined) throw new RequiredTitleError("no title");
  return <h2>{title}</h2>;
}

/** The same check on an optional prop: any caller can leave it out, so it is a render failure. */
export function Caption({ text }: { text?: string }) {
  if (!text) throw new TitleError("no caption");
  return <small>{text}</small>;
}

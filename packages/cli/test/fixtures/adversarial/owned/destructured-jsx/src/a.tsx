import { session } from "./session.js";

export function Tags() {
  const { tags } = session;
  tags.push("seen");
  return <p>{tags.length}</p>;
}

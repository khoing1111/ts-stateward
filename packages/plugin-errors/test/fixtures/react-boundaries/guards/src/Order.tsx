import { NotFoundError } from "./errors";

/** A real render failure: a boundary is what shows it. */
export function Order(props: { id: string; known: boolean }) {
  if (props.id === "") throw new NotFoundError("no order");
  return <p>{props.id}</p>;
}

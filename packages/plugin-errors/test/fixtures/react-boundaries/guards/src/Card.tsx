/**
 * A check on what the caller passed that its type already rules out: an invariant, not a failure
 * to show.
 */
export function Card(props: { title: string; body: string }) {
  if (props.title === undefined) throw new Error("Card needs a title");
  return (
    <section>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
    </section>
  );
}

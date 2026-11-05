import { useParams } from "react-router-dom";
import { AuthError } from "./errors";

export function Header() {
  // What useParams throws is not known: this rule is about known errors only.
  const { id } = useParams();
  return (
    <header
      onClick={() => {
        // A handler: no boundary ever catches this, so it needs none above it.
        if (id === undefined) throw new AuthError("signed out");
      }}
    >
      User {id}
    </header>
  );
}

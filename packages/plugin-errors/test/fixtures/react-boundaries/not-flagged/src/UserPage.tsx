import { useState } from "react";
import { useParams } from "react-router-dom";
import { AuthError } from "./errors";
import { useUser } from "./users";

export function UserPage() {
  const { id = "" } = useParams();
  const user = useUser(id);
  const [signedIn, setSignedIn] = useState(true);
  return (
    <section>
      <h1>{user.name}</h1>
      <button
        onClick={() => {
          // A handler: a boundary never sees this.
          if (!signedIn) throw new AuthError("signed out");
          setSignedIn(false);
        }}
      >
        Sign out
      </button>
    </section>
  );
}

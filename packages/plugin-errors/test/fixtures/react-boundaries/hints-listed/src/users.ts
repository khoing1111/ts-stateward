import { useState } from "react";
import { NotFoundError } from "./errors";

export type User = { id: string; name: string };

const known = new Map<string, User>([["1", { id: "1", name: "Ada" }]]);

export function useUser(id: string): User {
  const [users] = useState(known);
  const user = users.get(id);
  if (user === undefined) throw new NotFoundError(`no user ${id}`);
  return user;
}

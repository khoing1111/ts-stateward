import { createContext } from "react";
import type { RequiredContext } from "./guarantees";

export type User = { name: string };

/** A local name for the marker, applied to a value made without the helper. */
type Needed<T> = RequiredContext<T>;

export const AuthCtx: Needed<User> = createContext<User>({ name: "" });

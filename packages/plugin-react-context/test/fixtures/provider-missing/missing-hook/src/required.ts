import { useContext, type Context } from "react";

/** The project's own helper: reads a context and throws when its Provider is missing. */
export function useRequired<T>(context: Context<T | undefined>): T {
  const value = useContext(context);
  if (value === undefined) throw new Error("a required context has no Provider");
  return value;
}

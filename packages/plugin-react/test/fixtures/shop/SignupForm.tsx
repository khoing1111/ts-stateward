import { useEffect, useMemo } from "react";
import { useForm } from "./form.js";

const INITIAL = { email: "", password: "" };

export function SignupForm() {
  const [values, setField, options, rules] = useForm(INITIAL);
  const errors = useMemo(
    () => (options.fields.includes("email") && values.email === "" ? ["email"] : []),
    [options, values],
  );
  useEffect(() => {
    setField("email", values.email.trim());
  }, [setField, values.email, rules]);
  return <p>{errors.join(", ")}</p>;
}

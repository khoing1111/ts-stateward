import { useCallback, useMemo, useState } from "react";

export type Values = Record<string, string>;

/** Returns a tuple: the values, a stable setter, and options rebuilt on every render. */
export function useForm(initial: Values) {
  const [values, setValues] = useState(initial);
  const setField = useCallback((name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);
  const rules = useMemo(() => ({ required: Object.keys(initial) }), [initial]);
  return [values, setField, { validateOnBlur: true, fields: Object.keys(values) }, rules] as const;
}

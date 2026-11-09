import type { Pending } from "./guarantees.js";
import { useState } from "./react.js";

declare function submit(): Promise<void>;

export function useForm() {
  // Stated: the marker is the type argument of the call that makes the state.
  const [isSubmitting, setSubmitting] = useState<Pending<boolean>>(false);
  // A copy of the same state under another name: not a state of its own.
  const loading = isSubmitting;

  async function onSubmit(): Promise<void> {
    if (loading) return;
    setSubmitting(true);
    try {
      await submit();
    } finally {
      setSubmitting(false);
    }
  }
  return { loading, onSubmit };
}

export class Upload {
  // Stated in its own annotation.
  busy: Pending<boolean> = false;
  // Copied from the field: not listed.
  readonly shown = this.busy;
}

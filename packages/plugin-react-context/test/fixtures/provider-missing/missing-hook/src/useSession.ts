import { useRequired } from "./required";
import { AuthCtx } from "./contexts";

export function useSession() {
  return useRequired(AuthCtx);
}

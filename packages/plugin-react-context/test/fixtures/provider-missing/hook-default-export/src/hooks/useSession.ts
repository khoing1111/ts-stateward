import { useRequired } from "../required";
import { AuthCtx } from "../contexts";

export default function useSession() {
  return useRequired(AuthCtx);
}

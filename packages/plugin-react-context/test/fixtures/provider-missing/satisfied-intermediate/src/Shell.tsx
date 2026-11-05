import { AuthCtx } from "./contexts";
import { Profile } from "./Profile";

export function Shell() {
  return (
    <AuthCtx.Provider value={{ name: "ada" }}>
      <Profile />
    </AuthCtx.Provider>
  );
}

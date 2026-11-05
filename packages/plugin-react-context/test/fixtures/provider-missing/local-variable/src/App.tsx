import { AuthCtx } from "./contexts";
import { Profile } from "./Profile";

export function App() {
  const header = <Profile />;
  return <AuthCtx.Provider value={{ name: "ada" }}>{header}</AuthCtx.Provider>;
}

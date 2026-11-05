import { AuthContext } from "./auth";
import { Order } from "./Order";
import { Profile } from "./Profile";

export function App() {
  return (
    <AuthContext.Provider value={{ name: "Ada" }}>
      <Profile />
      <Order id="" known={false} />
    </AuthContext.Provider>
  );
}

import { Panel } from "./Panel";
import { Profile } from "./Profile";

export function App() {
  return <Panel as={Profile} />;
}

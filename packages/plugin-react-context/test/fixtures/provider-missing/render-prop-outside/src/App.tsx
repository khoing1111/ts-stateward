import { List } from "./List";
import { Profile } from "./Profile";

export function App() {
  return <List renderItem={(id) => <Profile key={id} />} />;
}

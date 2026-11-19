import { session } from "./session.js";

function View({ value }: { value: Readonly<{ user: string | null; count: number }> }) {
  return <p>{value.user}</p>;
}

export function App() {
  return <View value={session} />;
}

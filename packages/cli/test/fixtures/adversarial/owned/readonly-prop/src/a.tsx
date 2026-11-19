import { session } from "./session.js";

function View({ value }: { value: Readonly<{ user: string | null; count: number }> }) {
  (value as { count: number }).count += 1;
  return <p>{value.user}</p>;
}

export function App() {
  return <View value={session} />;
}

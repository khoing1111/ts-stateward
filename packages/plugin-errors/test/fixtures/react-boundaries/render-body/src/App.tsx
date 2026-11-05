import { Header } from "./Header";
import { Session } from "./Session";
import { Caption, Title } from "./Title";

// a default-exported component is named by its function, not `default`.
export default function App() {
  return (
    <main>
      <Session />
      <Header />
      <Title title="Home" />
      <Caption />
    </main>
  );
}

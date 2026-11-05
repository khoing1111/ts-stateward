import { Card } from "./Card";
import { Layout } from "./Layout";
import { Profile } from "./Profile";

export function App() {
  return (
    <Layout>
      <Card>
        <Profile />
      </Card>
    </Layout>
  );
}

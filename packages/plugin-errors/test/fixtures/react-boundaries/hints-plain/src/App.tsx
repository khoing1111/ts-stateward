import { UserPage } from "./UserPage";

export function App() {
  return (
    <main>
      <nav>Menu</nav>
      <UserPage id={location.hash.slice(1)} />
    </main>
  );
}

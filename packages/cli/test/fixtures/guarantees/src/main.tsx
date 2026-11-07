import { Footer, Header, Profile } from "./Readers";

/** The app's root: its host renders it under `ThemeContext` (`entries` in the config). */
export function App() {
  return (
    <main>
      <Header />
      <Profile />
      <Footer />
    </main>
  );
}

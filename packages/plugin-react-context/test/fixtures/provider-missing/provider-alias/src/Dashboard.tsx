import { Profile, Themed } from "./Profile";
import { ThemeProvider } from "./providers";

export function Dashboard() {
  return (
    <main>
      <ThemeProvider value={{ dark: true }}>
        <Profile />
        <Themed />
      </ThemeProvider>
      <Themed />
    </main>
  );
}

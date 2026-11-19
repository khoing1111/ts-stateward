import { ThemeContext } from "./contexts.js";
import { Reader, Wrap } from "./parts.js";

export function App() {
  return (
    <ThemeContext value={{ color: "red" }}>
      <Wrap>
        <Reader />
      </Wrap>
    </ThemeContext>
  );
}

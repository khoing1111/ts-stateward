import { createContext, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

export const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(
  null,
);

/** The React Compiler memoizes this value: nothing to report. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

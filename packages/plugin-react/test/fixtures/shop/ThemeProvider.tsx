import { createContext, useMemo, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

export const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(
  null,
);
export const UserContext = createContext<{ name: string } | null>(null);
export const LocaleContext = createContext<readonly [string, (locale: string) => void] | null>(null);
export const SaveContext = createContext<(() => void) | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function UserProvider({ name, children }: { name: string; children: ReactNode }) {
  const user = { name };
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState("en");
  return <LocaleContext value={[locale, setLocale]}>{children}</LocaleContext>;
}

export function SaveProvider({ onSave, children }: { onSave: () => void; children: ReactNode }) {
  return <SaveContext value={() => onSave()}>{children}</SaveContext>;
}

/** Memoized: silent. */
export function StableThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const ItemContext = createContext<{ id: string; index: number } | null>(null);

/** The value reads the `.map` callback's parameters: no hook there, so the fix extracts a component. */
export function ItemList({ ids }: { ids: string[] }) {
  return (
    <ul>
      {ids.map((id, index) => (
        <ItemContext.Provider key={id} value={{ id, index }}>
          <li>{id}</li>
        </ItemContext.Provider>
      ))}
    </ul>
  );
}

/** The same through a local made in the callback. */
export function NamedItemList({ ids }: { ids: string[] }) {
  return (
    <ul>
      {ids.map((id, index) => {
        const item = { id, index };
        return (
          <ItemContext.Provider key={id} value={item}>
            <li>{id}</li>
          </ItemContext.Provider>
        );
      })}
    </ul>
  );
}

export const ToggleContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

/** `toggle` is new every render, so a `useMemo` of the value would be too. */
export function ToggleProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  function toggle() {
    setTheme(theme === "light" ? "dark" : "light");
  }
  return <ToggleContext.Provider value={{ theme, toggle }}>{children}</ToggleContext.Provider>;
}

/** The same through a local value, with two inputs rebuilt every render. */
export function ToolbarProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const toggle = () => setTheme(theme === "light" ? "dark" : "light");
  const reset = () => setTheme("light");
  const toolbar = { theme, toggle: () => toggle(), reset };
  return <ToggleContext.Provider value={toolbar}>{children}</ToggleContext.Provider>;
}

export const FieldContext = createContext<{ name: string } | null>(null);

/** real-world corpus (bulletproof-react's form): `props` is a new object every render; depend on `props.name`. */
export function FieldProvider({ children, ...props }: { children: ReactNode; name: string }) {
  return <FieldContext.Provider value={{ name: props.name }}>{children}</FieldContext.Provider>;
}

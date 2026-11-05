import { createContext } from "react";

export const Count = createContext(0);
export const Mode = createContext("light");
export const Fixed = createContext({ color: "red" } as const);

function own(createContext: (value: null) => string): string {
  return createContext(null);
}

export const Mine = own(() => "x");

type Theme = { color: string };

export const Parser = createContext({ parse: (x: unknown) => (x as number) + 1 });
export const Items = createContext([]);
export const Checked = createContext({ color: "red" } satisfies Theme);

// No default, `undefined` or `null`: the type says the value can be missing (React's usual pattern).
export const Honest = createContext<Theme | undefined>(undefined);
export const Nullable = createContext<Theme | null>(null);
export const Voided = createContext<Theme | undefined>(void 0);

// an optional context on purpose, readers handle `null`; the cast forms keep
// the missing value in the type, so they say the same.
export type SessionApi = { signOut: () => void };
export const OptionalSession = createContext<SessionApi | null>(null);
export const CastNullable = createContext(null as SessionApi | null);
export const CastUndefined = createContext(undefined as SessionApi | undefined);

// real-world corpus (excalidraw's DropdownMenuContentPropsContext, react-admin's SaveContext): the type
// given has no required property, so `{}` is a complete value of it, not a placeholder.
type Callbacks = { onSelect?: (id: string) => void; onClose?: () => void };
export const AllOptional = createContext<Callbacks>({});
export const OpenDictionary = createContext<Record<string, number>>({});

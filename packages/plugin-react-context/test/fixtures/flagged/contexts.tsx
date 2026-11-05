import React, { createContext, createContext as makeContext } from "react";

type Theme = { color: string };
type Item = { id: number };

export const A = createContext<Theme>({} as Theme);
export const B = createContext<Theme>(undefined as unknown as Theme);
export const D = createContext({} as Theme);
export const E = makeContext<Theme>(null!);
export const F = React.createContext({} as Theme);
export const G = createContext<Theme>((null!));
export const H = createContext({});
export const I = createContext({ color: "red" } as Theme);
export const J = createContext<Theme | null>({
  color: "red",
  extra: "something long",
} as Theme);
export const contexts = [createContext({} as Theme)];
const L = createContext<Theme>(null!);
export const M = createContext<Theme | null>(null!);
export const O = createContext({} satisfies Partial<Theme> as Theme);
export const P = createContext<Item[]>([] as Item[]);
export const ThemeContext = createContext<Theme>({} as Theme);

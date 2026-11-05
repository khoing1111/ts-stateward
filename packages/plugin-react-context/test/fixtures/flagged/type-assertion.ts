import { createContext } from "react";

type Theme = { color: string };

export const Q = createContext(<Theme>{});

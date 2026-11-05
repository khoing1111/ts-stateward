import { AuthCtx, ThemeCtx } from "./contexts";

export const AuthProvider = AuthCtx.Provider;
export const { Provider: ThemeProvider } = ThemeCtx;

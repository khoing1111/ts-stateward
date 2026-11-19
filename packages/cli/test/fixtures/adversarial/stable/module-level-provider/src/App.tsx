import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
const actions = { save: () => undefined };

export const element = <ActionsContext.Provider value={actions}>{null}</ActionsContext.Provider>;

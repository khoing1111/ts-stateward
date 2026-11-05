import { createApi } from "@reduxjs/toolkit/query/react";
import { useDispatch } from "react-redux";
import type { Dispatch } from "react-redux";

export const useAppDispatch = useDispatch.withTypes<Dispatch>();

export const api = createApi({ reducerPath: "api" });

export const { useSaveItemMutation, useLazyGetItemsQuery } = api;

/** Built by a function of the project: stateward cannot read what it returns. */
function makeStore() {
  return () => ({ reload: (filter: string) => Promise.resolve([filter]) });
}

export const useOrdersStore = makeStore();

export function fetchOrders(): Promise<string[]> {
  return Promise.resolve([]);
}

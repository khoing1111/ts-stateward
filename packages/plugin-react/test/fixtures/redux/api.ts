import { createApi } from "@reduxjs/toolkit/query/react";

const baseApi = createApi({ reducerPath: "api" });

export const api = baseApi.injectEndpoints({ endpoints: {} });

export const { useGetItemsQuery, useLazyGetItemsQuery, useSaveItemMutation } = api;

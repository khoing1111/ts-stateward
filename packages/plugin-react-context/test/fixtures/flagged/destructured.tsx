import React from "react";

type Theme = { color: string };

const { createContext } = React;
export const Destructured = createContext({} as Theme);

const { createContext: make } = React;
export const Renamed = make({} as Theme);

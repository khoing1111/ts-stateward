import { useContext, type ReactNode } from "react";
import { ThemeContext } from "./ctx.js";
import { OtherContext } from "./other.js";

const Provider = ThemeContext.Provider;

function Reader(): ReactNode {
  return <p>{useContext(ThemeContext).color}</p>;
}

export function App(): ReactNode {
  return (
    <OtherContext.Provider value={{ color: "y" }}>
      <Provider value={{ color: "x" }}>
        <Reader />
      </Provider>
    </OtherContext.Provider>
  );
}

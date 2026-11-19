import { Component, type ReactNode } from "react";
import { ThemeContext, type Theme } from "./ctx.js";

class Reader extends Component {
  static contextType = ThemeContext;
  declare context: Theme;
  render(): ReactNode {
    return <p>{this.context.color}</p>;
  }
}

export function App(): ReactNode {
  return <Reader />;
}

import { useContext } from "react";
import { AuthContext, ThemeContext } from "./contexts";

export function Header() {
  return <h1>{useContext(ThemeContext).dark ? "dark" : "light"}</h1>;
}

export function Footer() {
  return <p>{useContext(ThemeContext).dark ? "dark" : "light"}</p>;
}

export function Profile() {
  return <p>{useContext(AuthContext).name}</p>;
}

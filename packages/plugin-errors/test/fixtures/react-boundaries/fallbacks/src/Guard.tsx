import { Component, type ReactNode } from "react";
import { AuthError } from "./errors";

type State = { kind: "auth" | "other"; message: string };

export class Guard extends Component<{ children?: ReactNode }, State | null> {
  state: State | null = null;

  static getDerivedStateFromError(error: unknown): State | null {
    if (error instanceof AuthError) return { kind: "auth", message: error.message };
    return null;
  }

  render() {
    return this.state === null ? this.props.children : <p>{this.state.message}</p>;
  }
}

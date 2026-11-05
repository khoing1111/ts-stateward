import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }> {
  render() {
    return this.props.children;
  }
}

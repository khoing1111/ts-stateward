import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <p>Something broke.</p> : this.props.children;
  }
}

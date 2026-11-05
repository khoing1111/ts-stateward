import { Component, type ReactNode } from "react";

type State = { failed: "none" | "chart" | "other" };

export class PanelBoundary extends Component<{ children?: ReactNode }, State> {
  state: State = { failed: "none" };

  static getDerivedStateFromError(error: unknown): State {
    switch (true) {
      case error instanceof RangeError:
        return { failed: "chart" };
      default:
        return { failed: "other" };
    }
  }

  render() {
    if (this.state.failed !== "none") return <p>This panel could not be drawn.</p>;
    return this.props.children;
  }
}

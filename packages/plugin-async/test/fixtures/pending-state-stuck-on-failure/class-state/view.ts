// A class component's `setState`: an object written in place sets named keys; a computed state
// replaces the state in bulk and marks nothing as running.
type ViewState = { saving: boolean; roomId?: string };

export class View {
  state: ViewState = { saving: false };
  setState(update: Partial<ViewState> | ((prev: ViewState) => Partial<ViewState>)): void {
    void update;
  }

  // Reported: `saving: true` stays when the request fails.
  async save(): Promise<void> {
    this.setState({ saving: true });
    await fetch("/save");
    this.setState({ saving: false });
  }

  // Not reported: the new state is computed, not a running marker.
  async open(roomId: string): Promise<void> {
    const next: Partial<ViewState> = { roomId };
    this.setState(next as ViewState);
    await fetch("/open");
    this.setState({ saving: false });
  }

  // Not reported: an updater function.
  async refresh(): Promise<void> {
    this.setState((prev) => ({ ...prev, roomId: undefined }));
    await fetch("/refresh");
    this.setState({ saving: false });
  }
}

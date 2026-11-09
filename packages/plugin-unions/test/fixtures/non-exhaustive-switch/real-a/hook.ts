// inside `useMemo`, `selectedNode satisfies never` makes
// react-hooks/exhaustive-deps ask for `selectedNode` instead of `selectedNode.type`.
function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  void deps;
  return factory();
}

type PanelNode =
  | { type: "frame"; children: string[] }
  | { type: "text"; text: string }
  | { type: "image"; src: string };

export function usePanelTitle(selectedNode: PanelNode): string {
  return useMemo(() => {
    switch (selectedNode.type) {
      case "frame":
        return "Frame";
      case "text":
        return "Text";
      case "image":
        return "Image";
      default:
        return "";
    }
  }, [selectedNode.type]);
}

export function usePanelIcon(selectedNode: PanelNode): string {
  return useMemo(() => {
    switch (selectedNode.type) {
      case "frame":
        return "F";
      default:
        return "?";
    }
  }, [selectedNode.type]);
}

// A case reads more of the object than its tag: the object is a dependency already.
export function usePanelText(selectedNode: PanelNode): string {
  return useMemo(() => {
    switch (selectedNode.type) {
      case "frame":
        return "";
      case "text":
        return selectedNode.text;
      case "image":
        return "";
      default:
        return "";
    }
  }, [selectedNode]);
}

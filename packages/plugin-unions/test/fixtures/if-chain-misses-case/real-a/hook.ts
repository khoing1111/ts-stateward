// inside `useMemo` the tests go on a `const` of the tag, so the hook's
// dependencies stay `selectedNode.type`.
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
    if (selectedNode.type === "frame") {
      return "Frame";
    } else if (selectedNode.type === "text" || selectedNode.type === "image") {
      return "Content";
    } else {
      return "";
    }
  }, [selectedNode.type]);
}

export function usePanelIcon(selectedNode: PanelNode): string {
  return useMemo(() => {
    if (selectedNode.type === "frame") {
      return "F";
    } else if (selectedNode.type === "text") {
      return "T";
    } else {
      return "?";
    }
  }, [selectedNode.type]);
}

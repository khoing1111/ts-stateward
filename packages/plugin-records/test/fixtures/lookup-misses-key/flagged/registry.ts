// Found in the production corpus: a registry from a hook (tldraw's `actions`), a server response
// (mattermost's `stats`), and a value cast to a record. There is no literal to add a key to.
type Action = { label: string; onSelect: (source: string) => void };
declare function useActions(): Record<string, Action>;
declare const response: unknown;

export function zoomLabel(): string {
  const actions = useActions();
  return actions["zoom-in"].label;
}

export const users = (response as Record<string, number>)["total_users"];

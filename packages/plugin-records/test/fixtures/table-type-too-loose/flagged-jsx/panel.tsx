export function Panel(props: { items: Record<string, string> }): string {
  return Object.keys(props.items).join(",");
}

const items: Record<string, string> = { one: "1", two: "2" };

export const view = <Panel items={items} />;

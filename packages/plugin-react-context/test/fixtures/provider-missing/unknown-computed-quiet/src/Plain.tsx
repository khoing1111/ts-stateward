const panels = { a: () => <p>a</p> } as const;

export function Plain({ tab }: { tab: keyof typeof panels }) {
  const Panel = panels[tab];
  return <Panel />;
}

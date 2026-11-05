import { Profile } from "./Profile";

const panels = { profile: Profile } as const;

export function Dashboard({ tab }: { tab: keyof typeof panels }) {
  const Panel = panels[tab];
  return <Panel />;
}

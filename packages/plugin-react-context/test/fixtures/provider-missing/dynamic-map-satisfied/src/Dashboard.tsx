import { Profile } from "./Profile";
import { Settings } from "./Settings";

const panels = { profile: Profile, settings: Settings } as const;

export function Dashboard({ tab }: { tab: keyof typeof panels }) {
  const Panel = panels[tab];
  return <Panel />;
}

import { Profile } from "./Profile";
import { Settings } from "./Settings";

const panels = { profile: Profile, settings: Settings, 3: Settings };

export function Dashboard({ tab }: { tab: "profile" | 3 }) {
  const Panel = panels[tab];
  return <Panel />;
}

export function Account() {
  const Panel = panels["profile"];
  return <Panel />;
}

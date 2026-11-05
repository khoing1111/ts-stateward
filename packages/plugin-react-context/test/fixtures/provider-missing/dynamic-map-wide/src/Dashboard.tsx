import type { ComponentType } from "react";
import { Profile } from "./Profile";
import { Settings } from "./Settings";

const panels: Record<string, ComponentType> = { profile: Profile, settings: Settings };

export function Dashboard({ tab }: { tab: string }) {
  const Panel = panels[tab] ?? Profile;
  const Other = panels[tab];
  return Other ? <Other /> : <Panel />;
}

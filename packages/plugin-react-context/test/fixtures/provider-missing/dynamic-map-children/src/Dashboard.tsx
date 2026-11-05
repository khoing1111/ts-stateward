import type { ReactNode } from "react";
import { Profile } from "./Profile";
import { Settings } from "./Settings";

const frames = { profile: Profile, settings: Settings } as const;

export function Dashboard({ tab, children }: { tab: keyof typeof frames; children: ReactNode }) {
  const Frame = frames[tab];
  return <Frame>{children}</Frame>;
}

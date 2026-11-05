import { Profile } from "./Profile";

const panels = { profile: Profile, none: null } as const;

export function Dashboard({ tab }: { tab: keyof typeof panels }) {
  const Panel = panels[tab];
  let Mutable = Profile;
  if (tab === "none") Mutable = Profile;
  return Panel === null ? <Mutable /> : <Panel />;
}

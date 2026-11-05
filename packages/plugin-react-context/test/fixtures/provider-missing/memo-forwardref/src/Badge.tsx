import { memo } from "react";
import { Profile } from "./Profile";

function BadgeInner() {
  return <Profile />;
}

export const Badge = memo(BadgeInner);

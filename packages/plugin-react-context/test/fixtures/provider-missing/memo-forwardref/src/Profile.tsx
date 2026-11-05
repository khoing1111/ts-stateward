import { forwardRef, memo } from "react";
import { useRequired } from "./required";
import { AuthCtx } from "./contexts";

export const Profile = memo(
  forwardRef<HTMLHeadingElement>(function Profile(_props, ref) {
    const user = useRequired(AuthCtx);
    return <h1 ref={ref}>{user.name}</h1>;
  }),
);

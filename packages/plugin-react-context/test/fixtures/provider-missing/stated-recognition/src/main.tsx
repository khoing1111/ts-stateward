import { createRoot } from "react-dom/client";
import { SessionCtx } from "./index";
import { Profile } from "./Profile";

function Unreached() {
  return <Profile />;
}

createRoot(document.body).render(
  <>
    <SessionCtx.Provider value={{ name: "ada" }}>
      <Profile />
    </SessionCtx.Provider>
    <Profile />
  </>,
);

export { Unreached };

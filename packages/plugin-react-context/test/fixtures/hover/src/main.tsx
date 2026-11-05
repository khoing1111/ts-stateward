import { createRoot } from "react-dom/client";
import { Gate } from "./Gate";
import { AuthCtx } from "./contexts";
import { Menu } from "./Menu";
import { Plain } from "./Plain";
import { Profile } from "./Profile";
import { Shell } from "./Shell";

createRoot(document.body).render(
  <AuthCtx.Provider value={{ name: "ada" }}>
    <Shell>
      <Profile />
      <Menu />
      <Plain />
    </Shell>
    <Gate>
      <Plain />
    </Gate>
  </AuthCtx.Provider>,
);

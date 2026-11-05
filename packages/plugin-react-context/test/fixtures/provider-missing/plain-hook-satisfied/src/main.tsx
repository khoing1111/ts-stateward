import { createRoot } from "react-dom/client";
import { AuthContext } from "./auth";
import { Profile } from "./Profile";
import { Settings } from "./Settings";

createRoot(document.body).render(
  <>
    <AuthContext.Provider value={{ name: "ada" }}>
      <Profile />
    </AuthContext.Provider>
    <AuthContext value={{ name: "grace" }}>
      <Settings />
    </AuthContext>
  </>,
);

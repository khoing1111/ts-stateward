import { createRoot } from "react-dom/client";
import { Profile, Settings } from "./Profile";

createRoot(document.body).render(
  <>
    <Profile />
    <Settings />
  </>,
);

import { Landing } from "./Landing";
import { Profile } from "./Profile";

export function Home({ signedIn }: { signedIn: boolean }) {
  const Page = signedIn ? Profile : Landing;
  return <Page />;
}

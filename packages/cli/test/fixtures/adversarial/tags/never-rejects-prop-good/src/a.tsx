import { post, report } from "./lib.js";
import { Search } from "./search.js";

/** Shows its own errors. @neverRejects */
async function safePost(): Promise<void> {
  try {
    await post();
  } catch (error) {
    report(error);
  }
}

export function Inline() {
  return (
    <Search
      onSearch={async () => {
        try {
          await post();
        } catch (error) {
          report(error);
        }
      }}
    />
  );
}

export function ByName() {
  return <Search onSearch={safePost} />;
}

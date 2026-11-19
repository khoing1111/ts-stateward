import { post } from "./lib.js";
import { Search } from "./search.js";

export function Inline() {
  return (
    <Search
      onSearch={async () => {
        await post();
      }}
    />
  );
}

export function ByName() {
  return <Search onSearch={post} />;
}

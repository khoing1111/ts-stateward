import { all, bump, deepSafe1, deepSafe4, chained, handledThenThrown, lines, ping2, pong2, rethrows, loadSafe, loadUnsafe, ping, refresh, reload, settle, track } from "./lib.js";

export function Safe() {
  return (
    <div>
      <button onClick={async () => { await track("a"); }}>track</button>
      <button onClick={async () => { await refresh(); }}>refresh</button>
      <button onClick={async () => { await bump(1); }}>bump</button>
      <button onClick={async () => { await loadSafe("/a"); }}>load</button>
      <button onClick={async () => { await deepSafe1(); }}>deep first</button>
      <button onClick={async () => { await deepSafe4(); }}>deep4</button>
      <button onClick={async () => { await deepSafe1(); }}>deep again</button>
    </div>
  );
}

export function Unsafe({ pending, source }: { pending: Promise<void>; source: AsyncIterable<string> }) {
  return (
    <div>
      <button onClick={async () => { await loadUnsafe("/a"); }}>load</button>
      <button onClick={async () => { await reload(); }}>reload</button>
      <button onClick={async () => { await settle(pending); }}>settle</button>
      <button onClick={async () => { await ping(); }}>ping</button>
      <button onClick={async () => { await (await fetch("/a")).json(); }}>json</button>
      <button onClick={async () => { await (pending ? settle(pending) : loadUnsafe("/b")); }}>either</button>
      <button onClick={async () => { await all(["/a"]); }}>all</button>
      <button onClick={async () => { await rethrows(); }}>rethrows</button>
      <button onClick={async () => { await chained(); }}>chained</button>
      <button onClick={async () => { await handledThenThrown(); }}>then</button>
      <button onClick={async () => { await lines(source); }}>lines</button>
      <button onClick={async () => { await ping2(1); }}>ping</button>
      <button onClick={async () => { await pong2(1); }}>pong</button>
    </div>
  );
}

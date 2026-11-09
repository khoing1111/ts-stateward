import { use, useContext } from "react";
import { CacheContext, SessionContext, StoreContext, ThemeContext } from "./contexts";
import { Layout, StoreProvider } from "./Store";

function CartCount() {
  return <p>{useContext(StoreContext)?.items.length}</p>;
}

/** A second store under the one main.tsx renders. */
function Cart() {
  return (
    <StoreProvider>
      <CartCount />
    </StoreProvider>
  );
}

/** Two caches in the same JSX. */
function Panel({ small }: { small: boolean }) {
  return (
    <CacheContext value={{ size: 10 }}>
      <div>{small ? <CacheContext value={{ size: 1 }}>small</CacheContext> : null}</div>
    </CacheContext>
  );
}

/** A store given to Layout, which provides one around its children. */
function Shell() {
  return (
    <Layout>
      <StoreProvider>
        <CartCount />
      </StoreProvider>
    </Layout>
  );
}

function User() {
  return <p>{use(SessionContext).user}</p>;
}

/** Nested themes: ThemeContext states nothing, so no finding. */
function Themed() {
  return (
    <ThemeContext value="dark">
      <ThemeContext value="light">
        <User />
      </ThemeContext>
    </ThemeContext>
  );
}

export function App() {
  return (
    <>
      <Cart />
      <Panel small />
      <Themed />
    </>
  );
}

export function Other() {
  return <Shell />;
}

/** Rendered by nothing: its own nesting is still reported. */
export function Orphan() {
  return (
    <CacheContext value={{ size: 2 }}>
      <CacheContext value={{ size: 3 }}>orphan</CacheContext>
    </CacheContext>
  );
}

/** Not a component: where its Provider renders is not followed. */
export function renderBanner(text: string) {
  return <CacheContext value={{ size: 0 }}>{text}</CacheContext>;
}

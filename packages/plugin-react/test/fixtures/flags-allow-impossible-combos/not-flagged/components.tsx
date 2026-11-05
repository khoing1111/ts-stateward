import { useReducer, useState } from "react";
import * as React from "react";

type User = { id: number; name: string };

// Two unrelated booleans: each is read and set on its own.
export function Toggles() {
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  return (
    <div>
      <button onClick={() => setDark(!dark)}>{dark ? "dark" : "light"}</button>
      <button onClick={() => setCompact(!compact)}>{compact ? "compact" : "roomy"}</button>
    </div>
  );
}

// A reducer is already one state.
type Action = { type: "start" } | { type: "done"; user: User } | { type: "fail"; error: Error };
type Model = { loading: boolean; user: User | null; error: Error | null };
export function WithReducer() {
  const [model] = useReducer(
    (state: Model, action: Action): Model => {
      switch (action.type) {
        case "start":
          return { ...state, loading: true };
        case "done":
          return { loading: false, user: action.user, error: null };
        case "fail":
          return { loading: false, user: null, error: action.error };
      }
    },
    { loading: false, user: null, error: null },
  );
  return <p>{model.loading && model.user?.name}</p>;
}

// One flag, and state that is neither a boolean nor nullable.
export function OneFlag() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [name, setName] = useState("");
  return (
    <button
      onClick={() => {
        setOpen(!open);
        setCount(count + 1);
        setName("x");
      }}
    >
      {open && count > 0 && name}
    </button>
  );
}

// Set in different callbacks and read in different conditions.
export function Separate() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  return (
    <div>
      <button onClick={() => setOpen(true)}>{open ? "open" : "closed"}</button>
      <button onClick={() => setUser({ id: 1, name: "A" })}>{user ? user.name : "nobody"}</button>
    </div>
  );
}

// A `useState` that is not React's is not counted.
function useState2<T>(initial: T): [T, (value: T) => void] {
  return [initial, () => undefined];
}
function myUseState<T>(initial: T): [T, (value: T) => void] {
  return useState2(initial);
}
export function NotReacts() {
  const [a, setA] = myUseState(false);
  const [b, setB] = myUseState(false);
  setA(!a);
  setB(!b);
  return <p>{a && b}</p>;
}

// Not a component or hook: lower-case, so its states are not read.
function helper() {
  const [a, setA] = React.useState(false);
  const [b, setB] = React.useState(false);
  setA(!a);
  setB(!b);
  return a && b;
}
export const used = helper;

// The flags of two components do not mix, and a nested component is its own.
export function Outer() {
  const [a, setA] = useState(false);
  function Inner() {
    const [b, setB] = useState(false);
    return <button onClick={() => setB(!b)}>{a ? "a" : "b"}</button>;
  }
  return <button onClick={() => setA(!a)}>{Inner.name}</button>;
}

// A setter passed on, and a state read in a condition with a non-state.
export function Passed({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <input onChange={() => setBusy(!busy)} />
      <button onClick={() => [setOpen].forEach((set) => set(true))}>
        {open && ready ? "x" : busy ? "y" : "z"}
      </button>
    </div>
  );
}

// Put back to their initial values together (a form cleared after adding, details closed when the
// item changes): a reset, not one state (found on real apps). Each is otherwise used on its own.
export function TagForm({ add }: { add: (color: string | undefined, blur: boolean) => void }) {
  const [color, setColor] = useState<string | undefined>(undefined);
  const [blur, setBlur] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const submit = () => {
    add(color, blur);
    setColor(undefined);
    setBlur(false);
    setShowMap(false);
  };
  return (
    <form onSubmit={submit}>
      <input onChange={() => setColor("red")} />
      <input type="checkbox" onChange={() => setBlur(!blur)} />
      <button onClick={() => setShowMap(!showMap)}>{showMap ? "hide" : "show"}</button>
    </form>
  );
}

// `showMap && (…)` renders JSX that reads another state: the JSX is what is shown, not part of the
// condition (found on real apps).
export function Details({ copy }: { copy: () => Promise<void> }) {
  const [showMap, setShowMap] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <button onClick={() => setShowMap(!showMap)}>map</button>
      {showMap && (
        <button
          onClick={() => {
            void copy().then(() => setCopied(true));
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      )}
    </div>
  );
}

// real-world corpus (outline's DocumentMove, ApiKeyNew): a `disabled` condition lists every reason not to
// act; a choice not made yet and a move in progress are independent.
declare function moveTo(path: string): Promise<void>;
export function MoveDialog() {
  const [moving, setMoving] = useState(false);
  const [selectedPath, selectPath] = useState<string | null>(null);
  const move = async (path: string) => {
    setMoving(true);
    await moveTo(path);
    setMoving(false);
  };
  return (
    <div>
      <button onClick={() => selectPath("/docs")}>{selectedPath ?? "choose"}</button>
      <button disabled={!selectedPath || moving} onClick={() => selectedPath && void move(selectedPath)}>
        {moving ? "Moving…" : "Move"}
      </button>
    </div>
  );
}

export function NewKey({ name }: { name: string }) {
  const [isSaving, setIsSaving] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined);
  const isSubmitDisabled = isSaving || !name || !expiresAt;
  return (
    <form>
      <input type="date" onChange={(event) => setExpiresAt(event.target.valueAsDate ?? undefined)} />
      <button disabled={isSubmitDisabled} onClick={() => setIsSaving(true)}>
        Create
      </button>
    </form>
  );
}

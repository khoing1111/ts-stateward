import { settings } from "./settings.js";

type S = Readonly<{ theme: string; meta: Readonly<{ n: number }> }>;

export function View(props: { s: S }) {
  const meta = Object.assign({}, props.s.meta, { n: 5 });
  return (
    <p>
      {props.s.theme} {meta.n}
    </p>
  );
}

export function App() {
  return <View s={settings} />;
}

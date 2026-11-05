import { useRequired } from "./required";
import { AuthCtx } from "./contexts";

export function Page() {
  function Row() {
    const user = useRequired(AuthCtx);
    return <li>{user.name}</li>;
  }
  return (
    <AuthCtx.Provider value={{ name: "ada" }}>
      <ul>
        <Row />
      </ul>
    </AuthCtx.Provider>
  );
}

export function Bare() {
  const Cell = () => {
    const user = useRequired(AuthCtx);
    return <td>{user.name}</td>;
  };
  return (
    <table>
      <Cell />
    </table>
  );
}

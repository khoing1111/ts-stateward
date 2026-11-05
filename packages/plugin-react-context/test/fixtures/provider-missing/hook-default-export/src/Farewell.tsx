import useAccount from "./hooks/useSession";

export function Farewell() {
  const account = useAccount();
  return <p>{account.name}</p>;
}

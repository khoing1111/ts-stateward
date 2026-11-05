import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { fetchOrders, useAppDispatch, useOrdersStore, useSaveItemMutation } from "./store.js";

/** `dispatch` keeps its identity: only `filter` can change, so the message names it. */
export function Orders({ filter }: { filter: string }) {
  const dispatch = useAppDispatch();
  const [orders, setOrders] = useState<string[]>([]);
  useEffect(() => {
    fetchOrders().then((found) => {
      setOrders(found.filter((order) => order.includes(filter)));
      dispatch({ type: "orders/loaded" });
    });
  }, [dispatch, filter]);
  return <p>{orders.length}</p>;
}

/** Every dependency keeps its identity: the effect runs once, and no newer response can exist. */
export function SaveOnOpen({ id }: { id: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [save] = useSaveItemMutation();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    save("draft").then(() => {
      setSaved(true);
      dispatch({ type: "saved" });
      navigate("/done");
    });
  }, [save, dispatch, navigate]);
  return <p>{saved ? id : ""}</p>;
}

/** `reload` comes from a hook stateward cannot read; `stableHooks` says it keeps its identity. */
export function Reloader() {
  const { reload } = useOrdersStore();
  const [orders, setOrders] = useState<string[]>([]);
  useEffect(() => {
    reload("open").then(setOrders);
  }, [reload]);
  return <p>{orders.length}</p>;
}

/** real-world corpus (outline's `useStores()`): the store object itself is the dependency. */
export function StoreReloader() {
  const store = useOrdersStore();
  const [orders, setOrders] = useState<string[]>([]);
  useEffect(() => {
    store.reload("all").then(setOrders);
  }, [store]);
  return <p>{orders.length}</p>;
}

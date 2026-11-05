import { useCallback, useEffect, useReducer, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router";
import { useGetItemsQuery, useLazyGetItemsQuery, useSaveItemMutation } from "./api.js";
import { useStableCardHandlers } from "./handlers.js";
import { useActions, useAppDispatch, useAppSelector, useAppStore, useOldDispatch } from "./store.js";

export function Board({ id }: { id: string }) {
  const dispatch = useAppDispatch();
  const plain = useDispatch();
  const old = useOldDispatch();
  const actions = useActions();
  const store = useAppStore();
  const items = useAppSelector((state) => state.items);
  const navigate = useNavigate();
  const { data, refetch } = useGetItemsQuery(id);
  const [load] = useLazyGetItemsQuery();
  const [save] = useSaveItemMutation();
  const [count, setCount] = useState(0);
  const [, send] = useReducer((n: number, step: number) => n + step, 0);
  const { onOpen } = useStableCardHandlers();

  useEffect(() => {
    dispatch({ type: "opened" });
    plain({ type: "opened" });
    old({ type: "opened" });
    actions({ type: "opened" });
  }, [dispatch, plain, old, actions]);
  useEffect(() => {
    if (store.getState().items.length !== items.length) navigate("/");
  }, [store.getState, items, navigate]);
  useEffect(() => {
    load(id);
    void save(id);
    refetch();
  }, [load, save, refetch, id, data]);
  const open = useCallback(() => {
    setCount(count + 1);
    send(1);
    onOpen(id);
  }, [count, setCount, send, onOpen, id]);
  return <button onClick={open}>{data?.length}</button>;
}

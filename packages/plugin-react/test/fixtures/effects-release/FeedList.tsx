import { useEffect, useState } from "react";
import { connect, watchFeed } from "./feed.js";

export function Feed() {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    watchFeed((item) => setItems((current) => [...current, item]));
  }, []);
  useEffect(() => {
    const socket = connect();
    socket.send("hello");
  }, []);
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

export function CleanFeed() {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => watchFeed((item) => setItems((current) => [...current, item])), []);
  useEffect(() => {
    const socket = connect();
    socket.send("hello");
    return () => socket[Symbol.dispose]();
  }, []);
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

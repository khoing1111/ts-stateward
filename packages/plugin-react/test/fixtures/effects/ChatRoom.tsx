import { useEffect, useState } from "react";
import { bus, chat, presence, type Message } from "./api.js";

export function ChatRoom({ room }: { room: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  useEffect(() => {
    chat.subscribe(room, (message) => setMessages((current) => [...current, message]));
  }, [room]);
  return <ul>{messages.map((message) => <li key={message.id}>{message.text}</li>)}</ul>;
}

export function ChatRoomFixed({ room }: { room: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  useEffect(
    () => chat.subscribe(room, (message) => setMessages((current) => [...current, message])),
    [room],
  );
  return <ul>{messages.map((message) => <li key={message.id}>{message.text}</li>)}</ul>;
}

export function OnlineList() {
  const [online, setOnline] = useState<string[]>([]);
  useEffect(() => {
    const subscription = presence.subscribe(setOnline);
    void subscription;
  }, []);
  return <p>{online.join(", ")}</p>;
}

export function OnlineListFixed() {
  const [online, setOnline] = useState<string[]>([]);
  useEffect(() => {
    const subscription = presence.subscribe(setOnline);
    return () => subscription.unsubscribe();
  }, []);
  return <p>{online.join(", ")}</p>;
}

export function LiveFeed({ url }: { url: string }) {
  const [last, setLast] = useState("");
  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onmessage = (event: MessageEvent<string>) => setLast(event.data);
  }, [url]);
  return <p>{last}</p>;
}

export function LiveFeedFixed({ url }: { url: string }) {
  const [last, setLast] = useState("");
  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onmessage = (event: MessageEvent<string>) => setLast(event.data);
    return () => socket.close();
  }, [url]);
  return <p>{last}</p>;
}

export function BusListener({ event }: { event: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const onEvent = () => setCount((current) => current + 1);
    bus.on(event, onEvent);
    return () => bus.off(event, onEvent);
  }, [event]);
  return <p>{count}</p>;
}

export function BusListenerWrongOff({ event }: { event: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const onEvent = () => setCount((current) => current + 1);
    const other = () => undefined;
    bus.on(event, onEvent);
    return () => bus.off(event, other);
  }, [event]);
  return <p>{count}</p>;
}

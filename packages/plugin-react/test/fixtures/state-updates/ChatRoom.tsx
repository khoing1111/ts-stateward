import { useEffect, useState } from "react";
import { chat } from "./chat.js";

/** Every message replaces the list with the first render's messages plus one. */
export function ChatRoom({ room }: { room: string }) {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    return chat.on(room, (message) => setMessages([...messages, message]));
  }, [room]);
  return (
    <ul>
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

export function ChatRoomFixed({ room }: { room: string }) {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    return chat.on(room, (message) => setMessages((messages) => [...messages, message]));
  }, [room]);
  return <p>{messages.length}</p>;
}

/** `messages` is a dependency, so the listener is replaced with each message. */
export function ChatRoomResubscribed({ room }: { room: string }) {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    return chat.on(room, (message) => setMessages([...messages, message]));
  }, [room, messages]);
  return <p>{messages.length}</p>;
}

export function Viewport() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const onResize = () => setSize({ ...size, width: window.innerWidth });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return <p>{size.width}</p>;
}

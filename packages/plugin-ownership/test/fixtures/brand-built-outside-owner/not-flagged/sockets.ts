import type { RoomId, SessionId, SocketId } from "./socket.js";

declare const text: string;

export const socket = text as SocketId;
export const room = <RoomId>text;
export const session = text as SessionId;
export const sockets = [text] as SocketId[];

export function isSocketId(value: string): value is SocketId {
  return value !== "";
}

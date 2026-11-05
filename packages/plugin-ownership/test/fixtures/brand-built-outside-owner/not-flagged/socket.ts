// Brands that only label a value (excalidraw's `SocketId`): their files export no check, so a cast
// elsewhere bypasses nothing.
export type SocketId = string & { _brand: "SocketId" };

// Only takes the brand it returns: it checks nothing new.
export function sameSocket(id: SocketId): SocketId {
  return id;
}

export type RoomId = string & { readonly __brand: "RoomId" };

// A check that is not exported cannot be the way other files get one.
function roomId(text: string): RoomId | undefined {
  return text === "" ? undefined : (text as RoomId);
}

export const lobby = roomId("lobby");

// Made from nothing: a fresh id, not a value that passed a check.
export type SessionId = string & { readonly __brand: "SessionId" };

export function newSessionId(): SessionId {
  return Math.random().toString(36) as SessionId;
}

import type { OpenUnion } from "./guarantees.js";

/** The server adds kinds before this app knows them. */
export type Stated = OpenUnion<{ kind: "chat"; text: string } | { kind: string; payload: unknown }>;

export type Plain = { kind: "chat"; text: string } | { kind: string; payload: unknown };
